import assert from "node:assert/strict";
import test from "node:test";
import { guardRagflowEvidence } from "../lib/knowledge-slim/query";
import { serializeProject } from "../lib/projects/serialization";

test("retrieval guard rejects foreign datasets and unmapped documents", () => {
  const guarded = guardRagflowEvidence({
    datasetId: "dataset-a",
    allowedDocuments: new Map([["document-a", "客户确认稿.md"]]),
    evidence: [
      { id: "ok", datasetId: "dataset-a", documentId: "document-a", documentName: "internal-name.md", content: "PROJECT_A_CANARY_92841", similarity: 0.9 },
      { id: "foreign-dataset", datasetId: "dataset-b", documentId: "document-a", documentName: "bad.md", content: "PROJECT_B_CANARY_57392", similarity: 0.99 },
      { id: "foreign-document", datasetId: "dataset-a", documentId: "document-b", documentName: "bad.md", content: "PROJECT_B_CANARY_57392", similarity: 0.98 },
    ],
  });
  assert.equal(guarded.rejected, 2);
  assert.deepEqual(guarded.accepted.map((item) => item.content), ["PROJECT_A_CANARY_92841"]);
  assert.equal(guarded.accepted[0].documentName, "客户确认稿.md");
});

test("project serialization never exposes RAGFlow mappings or failure internals", () => {
  const serialized = serializeProject({
    id: "project-a",
    organizationId: "org-a",
    departmentId: null,
    name: "A",
    clientName: "Client",
    description: "",
    isInternal: false,
    status: "active",
    stage: "development",
    health: "healthy",
    startDate: null,
    targetLaunchDate: null,
    ragflowDatasetId: "must-not-reach-browser",
    knowledgeStatus: "ready",
    knowledgeFailureCode: "must-not-reach-browser",
    createdBy: "user-a",
    createdAt: new Date("2026-08-20T00:00:00Z"),
    updatedAt: new Date("2026-08-20T00:00:00Z"),
  });
  assert.equal("ragflowDatasetId" in serialized, false);
  assert.equal("knowledgeFailureCode" in serialized, false);
});
