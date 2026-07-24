#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertEvidenceIndex } from "./review-evidence-contract.mjs";
import {
  assertProducerContract,
  assertDigest,
  assertFullSha,
  assertReleaseSessionId,
  digestObject,
} from "./release/contract.mjs";

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
const requiredRetrievalReports = [
  "retrieval-calibration.json",
  "retrieval-calibration.md",
  "retrieval-evaluation.json",
  "retrieval-evaluation.md",
  "retrieval-verification-summary.json",
  "retrieval-verification-summary.md",
];
const requiredReleaseReports = [
  "release-database-rehearsal.json",
  "release-database-rehearsal.md",
  "release-disabled-image-rehearsal.json",
  "release-disabled-image-rehearsal.md",
  "release-smoke.json",
  "release-smoke.md",
  "production-authorization-contract.json",
  "production-authorization-contract.md",
  "production-phase-state-machine.json",
  "production-phase-state-machine.md",
  "production-rollout-rehearsal.json",
  "production-rollout-rehearsal.md",
  "production-rollout-rollback.json",
  "production-rollout-rollback.md",
  "production-rollout-resume.json",
  "production-rollout-resume.md",
  "production-compose-contract.json",
  "production-compose-contract.md",
  "production-secret-boundary.json",
  "production-secret-boundary.md",
];
const retrievalReportFiles = [];
for (const file of requiredRetrievalReports) {
  try {
    await readFile(path.join(root, file));
    retrievalReportFiles.push(file);
  } catch {
    // Failed CI runs may not have reached evaluation; status remains authoritative.
  }
}
const releaseReportFiles = [];
for (const file of requiredReleaseReports) {
  try {
    await readFile(path.join(root, file));
    releaseReportFiles.push(file);
  } catch {
    // Failed CI runs may not have reached release rehearsal.
  }
}

function fileDigest(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

const releaseReportDigests = [];
for (const filename of releaseReportFiles) {
  const contents = await readFile(path.join(root, filename));
  const jsonFilename = filename.replace(/\.md$/, ".json");
  let report;
  try {
    report = JSON.parse(await readFile(path.join(root, jsonFilename), "utf8"));
  } catch {
    throw new Error(`Release report companion JSON is invalid: ${jsonFilename}`);
  }
  if (report.producerVersion === "b3-c2-v2") {
    if (
      report.producer !== "projectai-release-tool" ||
      !/^production-[a-z0-9-]+$/.test(report.reportType) ||
      report.sourceMode !== "ci-artifact"
    ) {
      throw new Error(`CI Production rollout report has an invalid Producer Contract: ${filename}`);
    }
    assertFullSha(report.releaseCandidateSha, `${jsonFilename}.releaseCandidateSha`);
    assertDigest(report.releaseImageDigest, `${jsonFilename}.releaseImageDigest`);
    assertReleaseSessionId(report.releaseSessionId);
  } else {
    assertProducerContract(report, report.reportType, { allowSynthetic: false });
  }
  if (report.sourceMode !== "ci-artifact") {
    throw new Error(`CI Release report has invalid sourceMode: ${filename}`);
  }
  assertDigest(report.digest, `${jsonFilename}.digest`);
  const expectedReportDigest = digestObject(
    Object.fromEntries(Object.entries(report).filter(([key]) => key !== "digest")),
  );
  if (report.digest !== expectedReportDigest) {
    throw new Error(`CI Release report digest does not match its payload: ${jsonFilename}`);
  }
  releaseReportDigests.push({
    filename,
    sha256: fileDigest(contents),
    reportDigest: report.digest,
    reportType: report.reportType,
    releaseCandidateSha: report.releaseCandidateSha,
    releaseImageDigest: report.releaseImageDigest,
  });
}

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
  "screenshots/daily-report-confirmed.png",
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
  dailyReport: "/daily-report",
};

const missingScreenshots = requiredScreenshots.filter(
  (file) => !screenshotFiles.includes(file),
);
const ci = /^true$/i.test(process.env.CI || "");
const optional = (value) => value?.trim() || null;
const reviewStatus =
  process.env.REVIEW_ARTIFACT_STATUS?.trim() || (ci ? "" : "local");
const missingRetrievalReports = requiredRetrievalReports.filter(
  (file) => !retrievalReportFiles.includes(file),
);
const missingReleaseReports = requiredReleaseReports.filter(
  (file) => !releaseReportFiles.includes(file),
);
if (
  reviewStatus.toLowerCase() === "success" &&
  (process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "").startsWith("0.8.") &&
  missingRetrievalReports.length
) {
  throw new Error(
    `Successful B3-B2 evidence is missing Retrieval reports: ${missingRetrievalReports.join(", ")}`,
  );
}
if (
  reviewStatus.toLowerCase() === "success" &&
  (process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "").startsWith("0.8.") &&
  missingReleaseReports.length
) {
  throw new Error(
    `Successful B3-C1 evidence is missing Release reports: ${missingReleaseReports.join(", ")}`,
  );
}

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
  retrievalProfileId: "hybrid-rrf-v1",
  retrievalEvaluationDatasetVersion: "hybrid-retrieval-fictional-v1",
  requiredRetrievalReports,
  retrievalReportFiles,
  missingRetrievalReports,
  requiredReleaseReports,
  releaseReportFiles,
  missingReleaseReports,
  releaseReportDigests,
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
  status: reviewStatus,
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
