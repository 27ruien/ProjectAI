import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sanitizer = new URL("../scripts/sanitize-test-artifacts.mjs", import.meta.url);
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
];
const headSha = "a".repeat(40);
const testedMergeSha = "b".repeat(40);

function reviewEvidenceIndex(overrides = {}) {
  return {
    schemaVersion: 2,
    eventName: "pull_request",
    headSha,
    testedMergeSha,
    stagingSha: null,
    branch: "test-branch",
    workflowRunId: "123456",
    environment: "test",
    version: "test",
    buildTime: "2026-07-13T00:00:00Z",
    status: "failure",
    requiredScreenshots,
    screenshotFiles: [],
    missingScreenshots: requiredScreenshots,
    screenshotsComplete: false,
    ...overrides,
  };
}

function sanitizerEnvironment(overrides = {}) {
  return {
    ...process.env,
    CI: "false",
    DATABASE_URL: "",
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "projectai-sanitizer-test-"));
  const report = path.join(root, "playwright-report");
  await mkdir(report);
  return { root, report };
}

test("publishes only allowlisted evidence and redacts storage metadata", async () => {
  const { root, report } = await fixture();
  const resultsRoot = path.join(root, "test-results");
  const logsRoot = path.join(root, "test-logs");
  const reviewRoot = path.join(root, "review-artifacts");
  const endpoint = "http://projectai-ci-minio:9000";
  const bucket = "projectai-ci-files-123456";
  const accessKey = "projectai-ci-app-access";
  const secretKey = "projectai-ci-app-secret-Aa1-0123456789";
  const rootUser = "projectai-ci-root-user";
  const rootPassword = "projectai-ci-root-password-Aa1-0123456789";
  const objectKey = "projects/project-001/documents/doc-1/versions/version-1/random";
  const sessionValue = "opaque-session-token-for-storage-evidence";
  try {
    await Promise.all([
      mkdir(resultsRoot),
      mkdir(logsRoot),
      mkdir(reviewRoot),
    ]);
    await writeFile(path.join(report, "trace.zip"), Buffer.from("PK\u0003\u0004upload"));
    await writeFile(path.join(resultsRoot, "customer.pdf"), "%PDF-1.7\nfixture\n");
    await writeFile(path.join(reviewRoot, "customer.pdf"), "%PDF-1.7\nfixture\n");
    await writeFile(path.join(logsRoot, "customer-upload.pdf"), "%PDF-1.7\nfixture\n");
    await writeFile(
      path.join(reviewRoot, "evidence-index.json"),
      JSON.stringify(reviewEvidenceIndex()),
    );
    await writeFile(
      path.join(logsRoot, "integration.log"),
      [
        JSON.stringify({
          objectKey,
          storageEndpoint: endpoint,
          bucket,
          objectStorageAccessKey: accessKey,
          objectStorageSecretKey: secretKey,
        }),
        `OBJECT_STORAGE_ENDPOINT=${endpoint}`,
        `OBJECT_STORAGE_BUCKET=${bucket}`,
        `objectKey=${objectKey}`,
        JSON.stringify({ name: "projectai.session_token", value: sessionValue }),
      ].join("\n"),
    );

    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({
        MINIO_ROOT_USER: rootUser,
        MINIO_ROOT_PASSWORD: rootPassword,
        OBJECT_STORAGE_ENDPOINT: endpoint,
        OBJECT_STORAGE_BUCKET: bucket,
        OBJECT_STORAGE_ACCESS_KEY: accessKey,
        OBJECT_STORAGE_SECRET_KEY: secretKey,
      }),
    });

    const outputRoot = path.join(root, "product-review-evidence");
    await assert.rejects(access(path.join(outputRoot, "playwright-report")));
    await assert.rejects(access(path.join(outputRoot, "test-results")));
    await assert.rejects(access(path.join(outputRoot, "review-artifacts/customer.pdf")));
    await assert.rejects(access(path.join(outputRoot, "test-logs/customer-upload.pdf")));

    const sanitized = await readFile(
      path.join(outputRoot, "test-logs/integration.log"),
      "utf8",
    );
    for (const unsafe of [
      endpoint,
      bucket,
      accessKey,
      secretKey,
      rootUser,
      rootPassword,
      objectKey,
      sessionValue,
    ]) {
      assert.equal(sanitized.includes(unsafe), false);
    }
    assert.match(sanitized, /\[REDACTED\]/);

    const reportJson = JSON.parse(
      await readFile(path.join(outputRoot, "sanitization-report.json"), "utf8"),
    );
    assert.deepEqual(reportJson.copiedRoots.sort(), [
      "review-artifacts",
      "test-logs",
    ]);
    assert.ok(reportJson.disallowedEvidenceEntriesRemoved >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when an allowlisted log contains an upload payload", async () => {
  const { root } = await fixture();
  const logsRoot = path.join(root, "test-logs");
  try {
    await mkdir(logsRoot);
    await writeFile(path.join(logsRoot, "integration.log"), "%PDF-1.7\nfixture\n");
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment(),
      }),
      /not safe UTF-8 text/i,
    );
    await assert.rejects(
      access(path.join(root, "product-review-evidence/test-logs/integration.log")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("redacts whitespace-folded storage secrets and raw object keys", async () => {
  const { root } = await fixture();
  const logsRoot = path.join(root, "test-logs");
  const secret = "storage-whitespace-base64-secret-Aa1!";
  const objectKey = "projects/project-001/documents/doc-1/versions/version-1/random";
  const foldedBase64 = Buffer.from(secret, "utf8")
    .toString("base64")
    .match(/.{1,8}/g)
    .join("\n ");
  try {
    await mkdir(logsRoot);
    await writeFile(
      path.join(logsRoot, "storage-integration.log"),
      `encoded=${foldedBase64}\nobject_key=${objectKey}\n`,
    );
    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ OBJECT_STORAGE_SECRET_KEY: secret }),
    });
    const sanitized = await readFile(
      path.join(
        root,
        "product-review-evidence/test-logs/storage-integration.log",
      ),
      "utf8",
    );
    assert.match(sanitized, /\[REDACTED\]/);
    assert.equal(sanitized.includes(foldedBase64), false);
    assert.equal(sanitized.includes(objectKey), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("redacts unlabeled canonical object keys in raw and encoded forms", async () => {
  const { root } = await fixture();
  const logsRoot = path.join(root, "test-logs");
  const objectKey =
    "projects/project-001/documents/document-001/versions/version-001/123e4567-e89b-12d3-a456-426614174000";
  const percentEncodedObjectKey = encodeURIComponent(objectKey);
  const jsonEscapedObjectKey = objectKey.replaceAll("/", "\\/");
  const nestedJsonEscapedObjectKey = JSON.stringify({
    message: jsonEscapedObjectKey,
  });
  try {
    await mkdir(logsRoot);
    await writeFile(
      path.join(logsRoot, "storage-integration.log"),
      [
        `inventory result ${objectKey}`,
        `request target ${percentEncodedObjectKey}`,
        `trace payload {"message":"${jsonEscapedObjectKey}"}`,
        `nested trace ${nestedJsonEscapedObjectKey}`,
      ].join("\n"),
    );
    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment(),
    });
    const sanitized = await readFile(
      path.join(
        root,
        "product-review-evidence/test-logs/storage-integration.log",
      ),
      "utf8",
    );
    for (const unsafe of [
      objectKey,
      percentEncodedObjectKey,
      jsonEscapedObjectKey,
      nestedJsonEscapedObjectKey,
    ]) {
      assert.equal(sanitized.includes(unsafe), false);
    }
    assert.equal((sanitized.match(/\[REDACTED\]/g) ?? []).length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires complete successful CI screenshots but accepts explicit failure evidence", async () => {
  const { root } = await fixture();
  const reviewRoot = path.join(root, "review-artifacts");
  try {
    await mkdir(reviewRoot);
    await writeFile(
      path.join(reviewRoot, "evidence-index.json"),
      JSON.stringify(reviewEvidenceIndex({ status: "success" })),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment({ CI: "true" }),
      }),
    );

    await writeFile(
      path.join(reviewRoot, "evidence-index.json"),
      JSON.stringify(reviewEvidenceIndex()),
    );
    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ CI: "true" }),
    });
    const failureReport = JSON.parse(
      await readFile(
        path.join(root, "product-review-evidence/sanitization-report.json"),
        "utf8",
      ),
    );
    assert.equal(failureReport.reviewStatus, "failure");
    assert.equal(failureReport.screenshotsComplete, false);
    assert.deepEqual(failureReport.missingReviewScreenshots, requiredScreenshots);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts CI evidence only when the index and required screenshots exist", async () => {
  const { root } = await fixture();
  const reviewRoot = path.join(root, "review-artifacts");
  const screenshotsRoot = path.join(reviewRoot, "screenshots");
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  try {
    await mkdir(screenshotsRoot, { recursive: true });
    for (const screenshot of requiredScreenshots) {
      await writeFile(path.join(reviewRoot, screenshot), onePixelPng);
    }
    await writeFile(
      path.join(reviewRoot, "evidence-index.json"),
      JSON.stringify(
        reviewEvidenceIndex({
          status: "success",
          screenshotFiles: requiredScreenshots,
          missingScreenshots: [],
          screenshotsComplete: true,
        }),
      ),
    );
    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ CI: "true" }),
    });
    const reportJson = JSON.parse(
      await readFile(
        path.join(root, "product-review-evidence/sanitization-report.json"),
        "utf8",
      ),
    );
    assert.equal(reportJson.status, "passed");
    assert.equal(reportJson.screenshotCount, requiredScreenshots.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects legacy commit provenance and an authoritative manifest in payload A", async () => {
  const { root } = await fixture();
  const reviewRoot = path.join(root, "review-artifacts");
  try {
    await mkdir(reviewRoot);
    await writeFile(
      path.join(reviewRoot, "evidence-index.json"),
      JSON.stringify(reviewEvidenceIndex({ commit: headSha })),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment({ CI: "true" }),
      }),
      /legacy product review commit field/i,
    );

    await writeFile(
      path.join(reviewRoot, "evidence-index.json"),
      JSON.stringify(reviewEvidenceIndex()),
    );
    await writeFile(
      path.join(reviewRoot, "manifest.json"),
      JSON.stringify({ artifactId: "123" }),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment({ CI: "true" }),
      }),
      /must not contain a legacy authoritative manifest/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when configured Session storage cannot be verified", async () => {
  const { root } = await fixture();
  const logsRoot = path.join(root, "test-logs");
  try {
    await mkdir(logsRoot);
    await writeFile(path.join(logsRoot, "integration.log"), "test failure\n");
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment({
          DATABASE_URL: "postgresql://user:password@127.0.0.1:1/unavailable",
          BETTER_AUTH_SECRET: "sanitizer-storage-failure-secret-Aa1!",
        }),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
