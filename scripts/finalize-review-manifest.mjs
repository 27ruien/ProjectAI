#!/usr/bin/env node

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertEvidenceIndex,
  assertPublishedArtifactIdentity,
  normalizeArtifactDigest,
} from "./review-evidence-contract.mjs";

const payloadRoot = path.resolve("product-review-evidence");
const reviewRoot = path.join(payloadRoot, "review-artifacts");
const indexPath = path.join(reviewRoot, "evidence-index.json");
const legacyManifestPath = path.join(reviewRoot, "manifest.json");
const outputRoot = path.resolve("product-review-manifest");
const outputPath = path.join(outputRoot, "manifest.json");

await rm(outputRoot, { recursive: true, force: true });

try {
  await access(legacyManifestPath);
  throw new Error(
    "The evidence payload contains a legacy authoritative manifest.",
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

let evidenceIndex;
try {
  evidenceIndex = JSON.parse(await readFile(indexPath, "utf8"));
} catch {
  throw new Error("The sanitized evidence payload has no valid evidence index.");
}
assertEvidenceIndex(evidenceIndex, { ci: evidenceIndex.eventName !== "local" });

const artifactId = process.env.REVIEW_ARTIFACT_ID?.trim() || "";
const artifactName = process.env.REVIEW_ARTIFACT_NAME?.trim() || "";
const expectedWorkflowRunId = process.env.GITHUB_RUN_ID?.trim() || "";
assertPublishedArtifactIdentity({
  artifactId,
  artifactName,
  workflowRunId: evidenceIndex.workflowRunId,
  expectedWorkflowRunId,
});
const artifactDigest = normalizeArtifactDigest(
  process.env.REVIEW_ARTIFACT_DIGEST,
);

const manifest = {
  schemaVersion: 3,
  headSha: evidenceIndex.headSha,
  testedMergeSha: evidenceIndex.testedMergeSha,
  stagingSha: evidenceIndex.stagingSha,
  branch: evidenceIndex.branch,
  workflowRunId: evidenceIndex.workflowRunId,
  artifactId,
  version: evidenceIndex.version,
  buildTime: evidenceIndex.buildTime,
  artifactName,
  artifactDigest,
  environment: evidenceIndex.environment,
  eventName: evidenceIndex.eventName,
  status: evidenceIndex.status,
  workerVersion: evidenceIndex.workerVersion,
  parserVersion: evidenceIndex.parserVersion,
  chunkerVersion: evidenceIndex.chunkerVersion,
  aiGatewayVersion: evidenceIndex.aiGatewayVersion,
  assistantProfileId: evidenceIndex.assistantProfileId,
  retrievalProfileId: evidenceIndex.retrievalProfileId,
  retrievalEvaluationDatasetVersion:
    evidenceIndex.retrievalEvaluationDatasetVersion,
  requiredRetrievalReports: evidenceIndex.requiredRetrievalReports,
  retrievalReportFiles: evidenceIndex.retrievalReportFiles,
  missingRetrievalReports: evidenceIndex.missingRetrievalReports,
  requiredReleaseReports: evidenceIndex.requiredReleaseReports,
  releaseReportFiles: evidenceIndex.releaseReportFiles,
  missingReleaseReports: evidenceIndex.missingReleaseReports,
  releaseReportDigests: evidenceIndex.releaseReportDigests,
  testedUsers: evidenceIndex.testedUsers,
  routes: evidenceIndex.routes,
  screenshotFiles: evidenceIndex.screenshotFiles,
  screenshots: evidenceIndex.screenshots,
  requiredScreenshots: evidenceIndex.requiredScreenshots,
  missingScreenshots: evidenceIndex.missingScreenshots,
  screenshotsComplete: evidenceIndex.screenshotsComplete,
};

await mkdir(outputRoot, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(
  `Published review manifest references evidence artifact ${artifactId}.\n`,
);
