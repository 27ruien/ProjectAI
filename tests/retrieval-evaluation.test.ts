import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateHybridRetrieval } from "../lib/ai/retrieval/evaluation";

describe("fictional hybrid retrieval evaluation gate", () => {
  it("evaluates at least 60 queries and passes every frozen v1 quality gate", async () => {
    const result = await evaluateHybridRetrieval();
    assert.ok(result.queryCount >= 60);
    assert.equal(result.profile.id, "hybrid-rrf-v1");
    assert.equal(result.safety.crossProjectLeakage, 0);
    assert.equal(result.safety.oldVersionLeakage, 0);
    assert.equal(result.safety.archivedLeakage, 0);
    assert.equal(result.safety.invalidChunkLeakage, 0);
    assert.equal(result.passed, true, JSON.stringify(result.gates));
  });
});
