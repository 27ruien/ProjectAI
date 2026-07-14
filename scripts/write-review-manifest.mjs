#!/usr/bin/env node

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("review-artifacts");
const screenshotsRoot = path.join(root, "screenshots");
await mkdir(screenshotsRoot, { recursive: true });

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

const manifest = {
  commit: process.env.REVIEW_COMMIT || process.env.GITHUB_SHA || "local",
  branch: process.env.REVIEW_BRANCH || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "local",
  environment: process.env.NEXT_PUBLIC_APP_ENV || "test",
  version: process.env.NEXT_PUBLIC_APP_VERSION || "local",
  buildTime: process.env.REVIEW_BUILD_TIME || process.env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString(),
  viewport: { width: 1440, height: 1000 },
  testedUsers: ["system_admin", "project_manager_a", "viewer_a"],
  routes,
  screenshotFiles,
  requiredScreenshots,
  missingScreenshots,
  screenshotsComplete: missingScreenshots.length === 0,
  status: process.env.REVIEW_ARTIFACT_STATUS || "local",
};

await writeFile(path.join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Product review manifest contains ${screenshotFiles.length} screenshot(s).\n`);
