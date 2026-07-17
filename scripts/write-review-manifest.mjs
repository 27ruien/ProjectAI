#!/usr/bin/env node

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertEvidenceIndex } from "./review-evidence-contract.mjs";

const root = path.resolve("review-artifacts");
const screenshotsRoot = path.join(root, "screenshots");
const evidenceIndexPath = path.join(root, "evidence-index.json");
const legacyManifestPath = path.join(root, "manifest.json");
await mkdir(screenshotsRoot, { recursive: true });

// Never let a failed regeneration leave publishable provenance from an older run.
await Promise.all([
  rm(evidenceIndexPath, { force: true }),
  rm(legacyManifestPath, { force: true }),
]);

const screenshotFiles = (await readdir(screenshotsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.png$/i.test(entry.name))
  .map((entry) => `screenshots/${entry.name}`)
  .sort();

const requiredScreenshots = [
  "screenshots/login.png",
  "screenshots/dashboard-admin.png",
  "screenshots/projects-manager-a.png",
  "screenshots/project-a-overview.png",
  "screenshots/project-access-denied.png",
  "screenshots/viewer-readonly.png",
  "screenshots/documents-empty.png",
  "screenshots/documents-upload-dialog.png",
  "screenshots/documents-uploaded.png",
  "screenshots/document-version-history.png",
  "screenshots/viewer-documents-readonly.png",
  "screenshots/document-upload-rejected.png",
  "screenshots/document-processing-pending.png",
  "screenshots/document-processing-succeeded.png",
  "screenshots/document-processing-failed.png",
  "screenshots/document-needs-ocr.png",
  "screenshots/knowledge-search-results.png",
  "screenshots/knowledge-search-pdf-citation.png",
  "screenshots/knowledge-search-docx-citation.png",
  "screenshots/knowledge-search-xlsx-citation.png",
  "screenshots/knowledge-search-pptx-citation.png",
  "screenshots/viewer-knowledge-search.png",
  "screenshots/ai-assistant-disabled.png",
  "screenshots/ai-assistant-empty.png",
  "screenshots/ai-assistant-grounded-answer.png",
  "screenshots/ai-assistant-citation-expanded.png",
  "screenshots/ai-assistant-insufficient-evidence.png",
  "screenshots/ai-assistant-provider-error.png",
  "screenshots/ai-assistant-viewer.png",
  "screenshots/ai-assistant-thread-history.png",
];

const routes = {
  login: "/login",
  dashboardAdmin: "/dashboard",
  projectsManagerA: "/projects",
  projectAOverview: "/projects/project-001/overview",
  projectAccessDenied: "/projects/project-002/overview",
  viewerReadonly: "/projects/project-001/overview",
  documents: "/projects/project-001/documents",
  projectAssistant: "/projects/project-001/knowledge",
};

const missingScreenshots = requiredScreenshots.filter(
  (file) => !screenshotFiles.includes(file),
);
const ci = /^true$/i.test(process.env.CI || "");
const optional = (value) => value?.trim() || null;

async function pngDimensions(relativePath) {
  const buffer = await readFile(path.join(root, relativePath));
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(signature) ||
    buffer.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error(`Review screenshot is not a valid PNG: ${relativePath}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) {
    throw new Error(`Review screenshot has invalid dimensions: ${relativePath}`);
  }
  return {
    filename: path.posix.basename(relativePath),
    width,
    height,
  };
}

if (process.env.REVIEW_COMMIT?.trim()) {
  throw new Error(
    "REVIEW_COMMIT is obsolete; provide REVIEW_HEAD_SHA and REVIEW_TESTED_MERGE_SHA.",
  );
}

const evidenceIndex = {
  schemaVersion: 3,
  eventName: process.env.REVIEW_EVENT_NAME?.trim() || (ci ? "" : "local"),
  headSha: ci ? optional(process.env.REVIEW_HEAD_SHA) : null,
  testedMergeSha: ci ? optional(process.env.REVIEW_TESTED_MERGE_SHA) : null,
  stagingSha: optional(process.env.REVIEW_STAGING_SHA),
  branch:
    process.env.REVIEW_BRANCH?.trim() ||
    process.env.GITHUB_HEAD_REF?.trim() ||
    process.env.GITHUB_REF_NAME?.trim() ||
    (ci ? "" : "local"),
  workflowRunId: ci ? optional(process.env.REVIEW_WORKFLOW_RUN_ID) : null,
  environment: process.env.NEXT_PUBLIC_APP_ENV?.trim() || (ci ? "" : "test"),
  version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || (ci ? "" : "local"),
  buildTime:
    process.env.NEXT_PUBLIC_BUILD_TIME?.trim() ||
    (ci ? "" : new Date().toISOString()),
  workerVersion: process.env.DOCUMENT_WORKER_VERSION?.trim() || "1",
  parserVersion: process.env.DOCUMENT_PARSER_VERSION?.trim() || "1",
  chunkerVersion: process.env.DOCUMENT_CHUNKER_VERSION?.trim() || "1",
  aiGatewayVersion: process.env.AI_GATEWAY_VERSION?.trim() || "1",
  assistantProfileId:
    process.env.AI_PROJECT_ASSISTANT_PROFILE_ID?.trim() ||
    "qwen-project-assistant-cn-v1",
  testedUsers: [
    "system_admin",
    "project_manager_a",
    "project_member_a",
    "viewer_a",
  ],
  routes,
  screenshotFiles,
  screenshots: await Promise.all(screenshotFiles.map(pngDimensions)),
  requiredScreenshots,
  missingScreenshots,
  screenshotsComplete: missingScreenshots.length === 0,
  status: process.env.REVIEW_ARTIFACT_STATUS?.trim() || (ci ? "" : "local"),
};

assertEvidenceIndex(evidenceIndex, { ci });
await writeFile(
  evidenceIndexPath,
  `${JSON.stringify(evidenceIndex, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `Product review evidence index contains ${screenshotFiles.length} screenshot(s).\n`,
);
