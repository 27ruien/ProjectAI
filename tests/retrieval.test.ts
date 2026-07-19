import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getHybridRetrievalRuntimeConfig,
  HYBRID_RETRIEVAL_PROFILE,
  reciprocalRankFusion,
  reciprocalRankFusionAudit,
} from "../lib/ai/retrieval";

type Value = { id: string };

function ranked(id: string, rank: number, score = 1) {
  return { chunkId: id, rank, score, value: { id } satisfies Value };
}

describe("deterministic reciprocal rank fusion", () => {
  it("handles lexical-only and vector-only candidates", () => {
    const lexical = reciprocalRankFusion({
      lexical: [ranked("lexical", 1)],
      vector: [],
      rrfK: 60,
      lexicalWeight: 1,
      vectorWeight: 1,
      limit: 30,
    });
    const vector = reciprocalRankFusion({
      lexical: [],
      vector: [ranked("vector", 1, 0.2)],
      rrfK: 60,
      lexicalWeight: 1,
      vectorWeight: 1,
      limit: 30,
    });
    assert.equal(lexical[0]?.candidateSource, "lexical");
    assert.equal(vector[0]?.candidateSource, "vector");
  });

  it("deduplicates a chunk found by both channels and sums only ranks", () => {
    const [candidate] = reciprocalRankFusion({
      lexical: [ranked("both", 2, 999)],
      vector: [ranked("both", 3, 0.1)],
      rrfK: 60,
      lexicalWeight: 1,
      vectorWeight: 1,
      limit: 30,
    });
    assert.equal(candidate?.candidateSource, "both");
    assert.equal(candidate?.rrfScore, 1 / 62 + 1 / 63);
    assert.equal(candidate?.lexicalScore, 999);
    assert.equal(candidate?.vectorDistance, 0.1);
  });

  it("applies weights and rrfK without mixing raw scores or distances", () => {
    const [candidate] = reciprocalRankFusion({
      lexical: [ranked("weighted", 1, 1000)],
      vector: [ranked("weighted", 1, 0.01)],
      rrfK: 10,
      lexicalWeight: 2,
      vectorWeight: 0.5,
      limit: 30,
    });
    assert.equal(candidate?.rrfScore, 2 / 11 + 0.5 / 11);
  });

  it("uses both-channel, ranks, and chunk id as stable tie breakers", () => {
    const input = {
      lexical: [ranked("z", 1), ranked("both", 2), ranked("a", 3)],
      vector: [ranked("both", 2, 0.2), ranked("a", 1, 0.1), ranked("z", 3, 0.3)],
      rrfK: 60,
      lexicalWeight: 1,
      vectorWeight: 1,
      limit: 30,
    };
    const first = reciprocalRankFusion(input);
    const second = reciprocalRankFusion(input);
    assert.deepEqual(first, second);
    assert.deepEqual(
      first.map((item) => item.finalRank),
      [1, 2, 3],
    );
  });

  it("enforces the fused candidate limit and supports empty input", () => {
    assert.deepEqual(
      reciprocalRankFusion({
        lexical: [],
        vector: [],
        rrfK: 60,
        lexicalWeight: 1,
        vectorWeight: 1,
        limit: 30,
      }),
      [],
    );
    const limited = reciprocalRankFusion({
      lexical: [ranked("a", 1), ranked("b", 2)],
      vector: [],
      rrfK: 60,
      lexicalWeight: 1,
      vectorWeight: 1,
      limit: 1,
    });
    assert.equal(limited.length, 1);
  });

  it("retains bounded channel candidates outside the fused limit for shadow audit", () => {
    const audited = reciprocalRankFusionAudit({
      lexical: [ranked("lexical", 1), ranked("lexical-dropped", 2)],
      vector: [ranked("vector", 1, 0.1)],
      rrfK: 60,
      lexicalWeight: 1,
      vectorWeight: 1,
      limit: 1,
    });
    assert.equal(audited.length, 3);
    assert.equal(audited.filter((item) => item.finalRank !== null).length, 1);
    assert.equal(
      audited.find((item) => item.chunkId === "lexical-dropped")?.lexicalRank,
      2,
    );
  });
});

describe("immutable hybrid retrieval runtime configuration", () => {
  const variables = [
    "AI_ASSISTANT_RETRIEVAL_MODE",
    "AI_HYBRID_RETRIEVAL_PROFILE_ID",
    "AI_HYBRID_QUERY_EMBEDDING_TIMEOUT_MS",
    "AI_HYBRID_VECTOR_SQL_TIMEOUT_MS",
    "AI_HYBRID_QUERY_EMBEDDING_DAILY_TOKEN_LIMIT",
  ] as const;
  const previous = new Map(variables.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("defaults to lexical and freezes evaluated v1 parameters", () => {
    for (const name of variables) delete process.env[name];
    const config = getHybridRetrievalRuntimeConfig();
    assert.equal(config.mode, "lexical");
    assert.equal(config.profileId, "hybrid-rrf-v1");
    assert.equal(HYBRID_RETRIEVAL_PROFILE.vectorMaxDistance, 0.55);
    assert.equal(HYBRID_RETRIEVAL_PROFILE.minEmbeddingCoverageBps, 9_800);
    assert.equal(HYBRID_RETRIEVAL_PROFILE.rrfK, 60);
    assert.equal(Object.isFrozen(HYBRID_RETRIEVAL_PROFILE), true);
  });

  it("accepts only lexical, shadow, and hybrid server modes", () => {
    for (const mode of ["lexical", "shadow", "hybrid"] as const) {
      process.env.AI_ASSISTANT_RETRIEVAL_MODE = mode;
      assert.equal(getHybridRetrievalRuntimeConfig().mode, mode);
    }
    process.env.AI_ASSISTANT_RETRIEVAL_MODE = "client-controlled";
    assert.throws(() => getHybridRetrievalRuntimeConfig());
  });

  it("rejects profile overrides and out-of-range timeouts or budgets", () => {
    process.env.AI_HYBRID_RETRIEVAL_PROFILE_ID = "hybrid-rrf-v2";
    assert.throws(() => getHybridRetrievalRuntimeConfig());
    delete process.env.AI_HYBRID_RETRIEVAL_PROFILE_ID;
    process.env.AI_HYBRID_QUERY_EMBEDDING_TIMEOUT_MS = "999";
    assert.throws(() => getHybridRetrievalRuntimeConfig());
    delete process.env.AI_HYBRID_QUERY_EMBEDDING_TIMEOUT_MS;
    process.env.AI_HYBRID_QUERY_EMBEDDING_DAILY_TOKEN_LIMIT = "8191";
    assert.throws(() => getHybridRetrievalRuntimeConfig());
  });
});
