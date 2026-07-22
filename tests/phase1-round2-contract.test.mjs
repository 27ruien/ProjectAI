import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) { return readFile(new URL(path, root), "utf8"); }

test("assistant source selection narrows both lexical and exact vector retrieval", async () => {
  const assistant = await source("lib/ai/project-assistant/service.ts");
  const retrieval = await source("lib/ai/retrieval/service.ts");
  assert.match(assistant, /sourceSelectionDigest/);
  assert.match(assistant, /listAuthorizedDocumentScope/);
  assert.match(retrieval, /documentIds: input\.sourceDocumentIds/);
  assert.match(retrieval, /and c\.document_id in/);
});

test("thread reads redact answer content after any citation authorization is revoked", async () => {
  const repository = await source("lib/ai/project-assistant/repository.ts");
  assert.match(repository, /revokedCitationMessages/);
  assert.match(repository, /内容已隐藏/);
});

test("AI extraction cannot write formal requirements before review", async () => {
  const requirements = await source("lib/project-management/requirements.ts");
  const extraction = requirements.slice(requirements.indexOf("export async function extractRequirementDrafts"), requirements.indexOf("function requirementSnapshotFrom"));
  assert.match(extraction, /insert\(requirementDraft\)/);
  assert.doesNotMatch(extraction, /insert\(requirement\)\./);
  assert.match(requirements, /DRAFT_ALREADY_REVIEWED/);
});

test("scope comparison requires explicit removal and preserves not-mentioned", async () => {
  const requirements = await source("lib/project-management/requirements.ts");
  assert.match(requirements, /candidate\.removalDeclarations\.includes/);
  assert.match(requirements, /"not_mentioned"/);
  assert.match(requirements, /未自动判定为删除/);
});
