import assert from "node:assert/strict";
import test from "node:test";
import { RagflowClient } from "../lib/ragflow/client";
import type { RagflowConfig } from "../lib/ragflow/config";

const config: RagflowConfig = {
  baseUrl: "http://ragflow.internal/api/v1",
  requestTimeoutMs: 1_000,
  retrievalTopK: 64,
  retrievalThreshold: 0.2,
  perProjectRetrievalLimit: 3,
  globalEvidenceLimit: 12,
  maxContextChars: 24_000,
  crossProjectConcurrency: 3,
};

test("RAGFlow client creates a dataset through the official v1 API with bearer authentication", async () => {
  const calls: Array<{ url: string; authorization: string | null; body: unknown }> = [];
  const client = new RagflowClient(config, "test-secret", async (input, init) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({ code: 0, data: { id: "dataset-a", name: "project-a", document_count: 0 } });
  });
  const dataset = await client.createDataset({ name: "project-a" });
  assert.equal(dataset.id, "dataset-a");
  assert.equal(calls[0].url, "http://ragflow.internal/api/v1/datasets");
  assert.equal(calls[0].authorization, "Bearer test-secret");
  assert.equal(JSON.stringify(calls).includes("test-secret"), true);
  assert.equal((calls[0].body as { chunk_method: string }).chunk_method, "naive");
});

test("RAGFlow retrieval sends only backend-resolved dataset IDs and does not require a RAGFlow chat model", async () => {
  const requestBodies: Array<{ dataset_ids: string[]; page_size: number; keyword: boolean }> = [];
  const client = new RagflowClient(config, "test-secret", async (_input, init) => {
    requestBodies.push(JSON.parse(String(init?.body)) as {
      dataset_ids: string[];
      page_size: number;
      keyword: boolean;
    });
    return Response.json({
      code: 0,
      data: {
        total: 3,
        chunks: [
          { id: "c1", dataset_id: "dataset-a", document_id: "d1", document_keyword: "one.md", content: "A", similarity: 0.9 },
          { id: "c2", dataset_id: "dataset-a", document_id: "d2", document_keyword: "two.md", content: "B", similarity: 0.8 },
          { id: "c3", dataset_id: "dataset-a", document_id: "d3", document_keyword: "three.md", content: "C", similarity: 0.7 },
        ],
      },
    });
  });
  const result = await client.retrieve({ question: "question", datasetIds: ["dataset-a"], limit: 2 });
  assert.deepEqual(requestBodies[0].dataset_ids, ["dataset-a"]);
  assert.equal(requestBodies[0].page_size, 2);
  assert.equal(requestBodies[0].keyword, false);
  assert.deepEqual(result.evidence.map((item) => item.documentId), ["d1", "d2"]);
});

test("RAGFlow client maps authentication failures to a controlled error", async () => {
  const client = new RagflowClient(config, "bad", async () => new Response(null, { status: 401 }));
  await assert.rejects(() => client.health(), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "RAGFLOW_UNAUTHORIZED");
    return true;
  });
});

test("RAGFlow dataset lookup treats an absent v0.27 name as an empty result", async () => {
  const calls: string[] = [];
  const client = new RagflowClient(config, "test-secret", async (input) => {
    calls.push(String(input));
    return Response.json({
      code: 0,
      data: [{ id: "dataset-a", name: "project-a", document_count: 1 }],
    });
  });
  assert.deepEqual(await client.listDatasets({ name: "missing-project" }), []);
  assert.deepEqual(calls, ["http://ragflow.internal/api/v1/datasets?page=1&page_size=100"]);
});
