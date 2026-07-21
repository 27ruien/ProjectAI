import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  EMBEDDING_BUDGET_RULE_VERSION,
  EMBEDDING_MODEL,
  TEXT_EMBEDDING_V4_MAX_TOKENS_PER_ITEM,
  TEXT_EMBEDDING_V4_MAX_TOKENS_PER_REQUEST,
  type EmbeddingRuntimeConfig,
  getEmbeddingRuntimeConfig,
} from "../lib/ai/embeddings/config";
import {
  EmbeddingPipelineError,
  EmbeddingProviderError,
} from "../lib/ai/embeddings/errors";
import { FakeEmbeddingProvider } from "../lib/ai/embeddings/fake-provider";
import { EmbeddingGateway } from "../lib/ai/embeddings/gateway";
import { embeddingReadiness } from "../lib/ai/embeddings/health";
import type {
  EmbeddingProvider,
  EmbeddingProviderResult,
} from "../lib/ai/embeddings/provider-types";
import { QwenEmbeddingProvider } from "../lib/ai/embeddings/qwen-provider";
import { runEmbeddingWorker } from "../lib/ai/embeddings/worker";
import { embeddingBatchReservedInputTokens } from "../lib/ai/embeddings/jobs";
import { selectEmbeddingBackfillCandidatesWithinChunkLimit } from "../lib/ai/embeddings/operations";
import { readFile, readdir, rm } from "node:fs/promises";

const originalEnvironment = { ...process.env };

afterEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  await rm("/tmp/projectai-embedding-worker-unit-heartbeat", { force: true });
});

function config(overrides: Partial<EmbeddingRuntimeConfig> = {}): EmbeddingRuntimeConfig {
  return {
    enabled: true,
    provider: "fake",
    profileId: "qwen-text-embedding-cn-v1",
    model: "text-embedding-v4",
    region: "cn-beijing",
    dimensions: 1024,
    qwenBaseUrl: null,
    timeoutMs: 1_000,
    pollMs: 250,
    leaseSeconds: 30,
    maxAttempts: 3,
    batchSize: 10,
    batchMaxCharacters: 30_000,
    dailyJobLimit: 500,
    dailyTokenLimit: 5_000_000,
    shutdownDrainMs: 25_000,
    ...overrides,
  };
}

class SequenceProvider implements EmbeddingProvider {
  readonly provider = "fake" as const;
  calls = 0;

  constructor(private readonly sequence: Array<EmbeddingProviderResult | Error>) {}

  async embed(): Promise<EmbeddingProviderResult> {
    const item = this.sequence[Math.min(this.calls, this.sequence.length - 1)]!;
    this.calls += 1;
    if (item instanceof Error) throw item;
    return item;
  }
}

function providerResult(vectorCount = 1): EmbeddingProviderResult {
  return {
    vectors: Array.from({ length: vectorCount }, () => Array(1024).fill(0.25)),
    actualModel: EMBEDDING_MODEL,
    inputTokens: 4,
    totalTokens: 4,
    providerRequestId: "safe-request-id",
    latencyMs: 12,
    dispatchClassification: "successful_response",
  };
}

describe("Phase 4 Backfill Chunk limit", () => {
  it("caps cumulative missing Chunks rather than Versions or Documents", () => {
    const candidates = [
      {
        projectId: "project-a",
        documentId: "document-a",
        versionId: "version-a",
        createdBy: "user-a",
        missingChunkCount: 60,
      },
      {
        projectId: "project-a",
        documentId: "document-b",
        versionId: "version-b",
        createdBy: "user-a",
        missingChunkCount: 50,
      },
      {
        projectId: "project-a",
        documentId: "document-c",
        versionId: "version-c",
        createdBy: "user-a",
        missingChunkCount: 40,
      },
      {
        projectId: "project-a",
        documentId: "document-d",
        versionId: "version-d",
        createdBy: "user-a",
        missingChunkCount: 101,
      },
    ];
    const selected = selectEmbeddingBackfillCandidatesWithinChunkLimit(
      candidates,
      100,
    );
    assert.deepEqual(
      selected.map((candidate) => candidate.versionId),
      ["version-a", "version-c"],
    );
    assert.equal(
      selected.reduce((total, candidate) => total + candidate.missingChunkCount, 0),
      100,
    );
  });
});

describe("embedding configuration and Gateway", () => {
  it("pins the read-only profile, dimensions, batch size, and fake-provider boundary", () => {
    Reflect.set(process.env, "NODE_ENV", "test");
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.AI_EMBEDDING_PROVIDER = "fake";
    process.env.AI_EMBEDDING_PROFILE_ID = "qwen-text-embedding-cn-v1";
    process.env.AI_EMBEDDING_DIMENSIONS = "1024";
    process.env.AI_EMBEDDING_BATCH_SIZE = "10";
    const parsed = getEmbeddingRuntimeConfig();
    assert.equal(parsed.profileId, "qwen-text-embedding-cn-v1");
    assert.equal(parsed.model, "text-embedding-v4");
    assert.equal(parsed.dimensions, 1024);
    assert.equal(parsed.batchSize, 10);

    process.env.AI_EMBEDDING_DIMENSIONS = "1536";
    assert.throws(() => getEmbeddingRuntimeConfig(), EmbeddingPipelineError);
    process.env.AI_EMBEDDING_DIMENSIONS = "1024";
    Reflect.set(process.env, "NODE_ENV", "production");
    assert.throws(() => getEmbeddingRuntimeConfig(), EmbeddingPipelineError);
  });

  it("accepts ordered 1024-dimensional batches and rejects count, dimension, and finite-value failures", async () => {
    const valid = new EmbeddingGateway(
      config(),
      new FakeEmbeddingProvider(),
    );
    const result = await valid.embed(["first", "second"]);
    assert.equal(result.vectors.length, 2);
    assert.equal(result.vectors[0]?.length, 1024);
    assert.ok(result.vectors.flat().every(Number.isFinite));

    for (const invalid of [
      providerResult(1),
      { ...providerResult(2), vectors: [Array(1023).fill(0), Array(1024).fill(0)] },
      { ...providerResult(2), vectors: [Array(1024).fill(Number.NaN), Array(1024).fill(0)] },
      { ...providerResult(2), vectors: [Array(1024).fill(Number.POSITIVE_INFINITY), Array(1024).fill(0)] },
    ]) {
      const gateway = new EmbeddingGateway(
        config(),
        new SequenceProvider([invalid]),
      );
      await assert.rejects(
        gateway.embed(["first", "second"]),
        (error: unknown) =>
          error instanceof EmbeddingPipelineError &&
          error.code === "PROVIDER_RESULT_UNKNOWN" &&
          !error.retryable &&
          error.dispatchClassification === "successful_response",
      );
    }
  });

  it("never retries post-dispatch failures and enforces the bounded aggregate input", async () => {
    const retrying = new SequenceProvider([
      new EmbeddingProviderError("RATE_LIMITED", true),
      new EmbeddingProviderError("SERVER_ERROR", true),
      providerResult(),
    ]);
    const gateway = new EmbeddingGateway(config(), retrying);
    await assert.rejects(
      gateway.embed(["retryable"]),
      (error: unknown) =>
        error instanceof EmbeddingPipelineError &&
        error.code === "PROVIDER_RESULT_UNKNOWN" &&
        !error.retryable &&
        error.dispatchClassification === "post_dispatch",
    );
    assert.equal(retrying.calls, 1);

    for (const code of ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN"] as const) {
      const provider = new SequenceProvider([
        new EmbeddingProviderError(code, false),
        providerResult(),
      ]);
      await assert.rejects(
        new EmbeddingGateway(config(), provider).embed([
          "non-retryable",
        ]),
      );
      assert.equal(provider.calls, 1);
    }
    await assert.rejects(
      gateway.embed(Array.from({ length: 11 }, () => "too many")),
      /Embedding operation failed/,
    );
    await assert.rejects(
      new EmbeddingGateway(config({ batchMaxCharacters: 1_000 }), retrying).embed([
        "x".repeat(1_001),
      ]),
    );
  });
});

describe("text-embedding-v4 hard budget reservation", () => {
  it("covers Chinese, mixed language, emoji, code, English, and ten-item batches", async () => {
    assert.equal(TEXT_EMBEDDING_V4_MAX_TOKENS_PER_ITEM, 8_192);
    assert.equal(TEXT_EMBEDDING_V4_MAX_TOKENS_PER_REQUEST, 33_000);
    assert.equal(
      EMBEDDING_BUDGET_RULE_VERSION,
      "text-embedding-v4-hard-limit-cn-beijing-v1",
    );
    const inputs = [
      "这是一个没有空格的中文项目说明",
      "Project 计划 mixed language 内容",
      "🚀🧪📚✅",
      "const result = items.map((item) => item.id);",
      "A concise English project requirement.",
    ];
    for (const input of inputs) {
      const chunks = [
        {
          id: crypto.randomUUID(),
          content: input,
          contentSha256: "a".repeat(64),
          chunkIndex: 0,
          estimatedTokenCount: 0,
        },
      ];
      const reservation = embeddingBatchReservedInputTokens(chunks);
      const result = await new EmbeddingGateway(
        config(),
        new FakeEmbeddingProvider(),
      ).embed([input]);
      assert.equal(reservation, 8_192);
      assert.ok((result.inputTokens ?? 0) <= reservation);
      assert.ok((result.inputTokens ?? 0) > chunks[0]!.estimatedTokenCount);
    }
    const tenChunks = Array.from({ length: 10 }, (_, index) => ({
      id: crypto.randomUUID(),
      content: inputs[index % inputs.length]!,
      contentSha256: index.toString(16).padStart(64, "0"),
      chunkIndex: index,
      estimatedTokenCount: 0,
    }));
    assert.equal(
      embeddingBatchReservedInputTokens(tenChunks),
      TEXT_EMBEDDING_V4_MAX_TOKENS_PER_REQUEST,
    );
  });
});

describe("Qwen embedding Adapter", () => {
  it("calls only /embeddings, preserves index order and Usage, and never exposes the Secret", async () => {
    Reflect.set(process.env, "NODE_ENV", "test");
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.QWEN_API_KEY = "unit-test-secret-value";
    let requestedUrl = "";
    let requestBody: Record<string, unknown> = {};
    const vectorA = Array(1024).fill(0.1);
    const vectorB = Array(1024).fill(0.2);
    const provider = new QwenEmbeddingProvider(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      async (url, init) => {
        requestedUrl = String(url);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: "provider-id",
            model: "text-embedding-v4",
            data: [
              { index: 1, embedding: vectorB },
              { index: 0, embedding: vectorA },
            ],
            usage: { prompt_tokens: 7, total_tokens: 7 },
          }),
          { status: 200, headers: { "x-request-id": "request-id" } },
        );
      },
    );
    const result = await provider.embed({
      model: "text-embedding-v4",
      dimensions: 1024,
      inputs: ["first", "second"],
      timeoutMs: 1_000,
    });
    assert.equal(requestedUrl.endsWith("/embeddings"), true);
    assert.equal(requestedUrl.includes("chat/completions"), false);
    assert.deepEqual(requestBody.input, ["first", "second"]);
    assert.equal(requestBody.model, "text-embedding-v4");
    assert.equal(requestBody.dimensions, 1024);
    assert.equal(result.vectors[0]?.[0], 0.1);
    assert.equal(result.vectors[1]?.[0], 0.2);
    assert.equal(result.inputTokens, 7);
    assert.equal(result.totalTokens, 7);
    assert.equal(JSON.stringify(result).includes("unit-test-secret-value"), false);
  });

  it("marks every explicit HTTP rejection unknown when billing certainty is undocumented", async () => {
    Reflect.set(process.env, "NODE_ENV", "test");
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.QWEN_API_KEY = "never-print-this-secret";
    for (const status of [429, 500, 401, 403, 400] as const) {
      const provider = new QwenEmbeddingProvider(
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        async () => new Response("sensitive provider body", { status }),
      );
      await assert.rejects(
        provider.embed({
          model: "text-embedding-v4",
          dimensions: 1024,
          inputs: ["safe text"],
          timeoutMs: 1_000,
        }),
        (error: unknown) => {
          assert.ok(error instanceof EmbeddingProviderError);
          assert.equal(error.code, "PROVIDER_RESULT_UNKNOWN");
          assert.equal(error.retryable, false);
          assert.equal(error.dispatchClassification, "explicit_http_rejection");
          assert.equal(error.message.includes("sensitive provider body"), false);
          assert.equal(error.message.includes("never-print-this-secret"), false);
          return true;
        },
      );
    }
  });

  it("marks timeout and network failures unknown after one dispatch", async () => {
    process.env.QWEN_API_KEY = "timeout-test-secret";
    for (const failure of [
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      new Error("network detail"),
    ]) {
      let calls = 0;
      const provider = new QwenEmbeddingProvider(
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        async () => {
          calls += 1;
          throw failure;
        },
      );
      await assert.rejects(
        provider.embed({
          model: "text-embedding-v4",
          dimensions: 1024,
          inputs: ["safe text"],
          timeoutMs: 1_000,
        }),
        (error: unknown) =>
          error instanceof EmbeddingProviderError &&
          error.code === "PROVIDER_RESULT_UNKNOWN" &&
          !error.retryable &&
          error.dispatchClassification === "post_dispatch" &&
          !error.message.includes("timeout-test-secret") &&
          !error.message.includes("network detail"),
      );
      assert.equal(calls, 1);
    }
  });

  it("marks 200 parse and validation failures unknown after one dispatch", async () => {
    process.env.QWEN_API_KEY = "invalid-response-test-secret";
    const responses = [
      new Response("not-json", { status: 200 }),
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
      new Response(
        JSON.stringify({
          model: "text-embedding-v4",
          data: [{ index: 0, embedding: [1] }],
        }),
        { status: 200 },
      ),
    ];
    for (const response of responses) {
      let calls = 0;
      const provider = new QwenEmbeddingProvider(
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        async () => {
          calls += 1;
          return response;
        },
      );
      await assert.rejects(
        provider.embed({
          model: "text-embedding-v4",
          dimensions: 1024,
          inputs: ["safe text"],
          timeoutMs: 1_000,
        }),
        (error: unknown) =>
          error instanceof EmbeddingProviderError &&
          error.code === "PROVIDER_RESULT_UNKNOWN" &&
          !error.retryable &&
          error.dispatchClassification === "post_dispatch",
      );
      assert.equal(calls, 1);
    }
  });

  it("distinguishes a shutdown abort after dispatch from a safe pre-dispatch abort", async () => {
    process.env.QWEN_API_KEY = "shutdown-test-secret";
    const controller = new AbortController();
    let dispatched = false;
    const provider = new QwenEmbeddingProvider(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
      async (_url, init) => {
        dispatched = true;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        });
      },
    );
    const pending = provider.embed({
      model: "text-embedding-v4",
      dimensions: 1024,
      inputs: ["fictional shutdown text"],
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    while (!dispatched) await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new Error("SIGTERM"));
    await assert.rejects(
      pending,
      (error: unknown) =>
        error instanceof EmbeddingProviderError &&
        error.code === "PROVIDER_RESULT_UNKNOWN" &&
        !error.retryable,
    );

    const preDispatch = new AbortController();
    preDispatch.abort(new Error("SIGTERM"));
    await assert.rejects(
      provider.embed({
        model: "text-embedding-v4",
        dimensions: 1024,
        inputs: ["fictional pre-dispatch text"],
        timeoutMs: 1_000,
        signal: preDispatch.signal,
      }),
      (error: unknown) =>
        error instanceof EmbeddingProviderError &&
        error.code === "SHUTDOWN_ABORTED" &&
        error.retryable,
    );
  });
});

describe("disabled Embedding Worker", () => {
  it("reports disabled without constructing or calling a Provider", async () => {
    process.env.AI_EMBEDDING_WORKER_HEARTBEAT_FILE =
      "/tmp/projectai-embedding-worker-unit-heartbeat";
    await runEmbeddingWorker({ once: true, config: config({ enabled: false }) });
    const heartbeat = await readFile(
      "/tmp/projectai-embedding-worker-unit-heartbeat",
      "utf8",
    );
    assert.match(heartbeat, / disabled\n$/);
  });
});

describe("Embedding health gate", () => {
  it("keeps Flag=false healthy without inspecting pre-0004 Embedding schema", async () => {
    let inspections = 0;
    const ready = await embeddingReadiness(
      config({ enabled: false }),
      false,
      async () => {
        inspections += 1;
        throw new Error("pre-0004 schema must not be queried");
      },
    );
    assert.equal(ready, false);
    assert.equal(inspections, 0);
  });

  it("rejects Flag=true when pgvector or the dedicated Worker is not ready", async () => {
    await assert.rejects(
      embeddingReadiness(
        config({
          provider: "qwen",
          qwenBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        }),
        true,
        async () => ({
          pgvectorEnabled: false,
          profileReady: true,
          jobsSchemaReady: true,
          batchesSchemaReady: true,
          providerCallsSchemaReady: true,
          vectorsSchemaReady: true,
          workerReady: false,
        }),
      ),
      /dependencies are unavailable/,
    );
  });
});

describe("B3-B2 centralized retrieval boundary", () => {
  it("does not expose vectors from browser routes or bypass the unified retrieval service", async () => {
    const routeEntries = await readdir(new URL("../app/api", import.meta.url), {
      recursive: true,
    });
    const routeFiles = routeEntries.filter((entry) => entry.endsWith("route.ts"));
    for (const entry of routeFiles) {
      const source = await readFile(
        new URL(`../app/api/${entry}`, import.meta.url),
        "utf8",
      );
      assert.doesNotMatch(
        source,
        /documentChunkEmbedding|findNearestEmbeddedChunksForProbe|\.embedding\b|vector\(1024\)/,
      );
    }
    for (const relativePath of [
      "../lib/documents/processing/search-service.ts",
      "../lib/ai/project-assistant/grounding.ts",
      "../lib/ai/project-assistant/service.ts",
    ]) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      assert.doesNotMatch(source, /ai\/embeddings|document_chunk_embeddings|<=>|vector\(/i);
    }
  });
});
