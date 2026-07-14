#!/usr/bin/env node

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
  .filter((entry) => entry.isFile() && /\.(?:png|jpe?g|webp)$/i.test(entry.name))
  .map((entry) => `screenshots/${entry.name}`)
  .sort();

const requiredScreenshots = [
  "screenshots/login.png",
  "screenshots/dashboard-admin.png",
  "screenshots/projects-manager-a.png",
  "screenshots/project-a-overview.png",
  "screenshots/project-access-denied.png",
  "screenshots/viewer-readonly.png",
];

const routes = {
  login: "/login",
  dashboardAdmin: "/dashboard",
  projectsManagerA: "/projects",
  projectAOverview: "/projects/project-001/overview",
  projectAccessDenied: "/projects/project-002/overview",
  viewerReadonly: "/projects/project-001/overview",
};

const missingScreenshots = requiredScreenshots.filter(
  (file) => !screenshotFiles.includes(file),
);
const ci = /^true$/i.test(process.env.CI || "");
const optional = (value) => value?.trim() || null;

if (process.env.REVIEW_COMMIT?.trim()) {
  throw new Error(
    "REVIEW_COMMIT is obsolete; provide REVIEW_HEAD_SHA and REVIEW_TESTED_MERGE_SHA.",
  );
}

const evidenceIndex = {
  schemaVersion: 2,
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
  viewport: { width: 1440, height: 1000 },
  testedUsers: ["system_admin", "project_manager_a", "viewer_a"],
  routes,
  screenshotFiles,
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
