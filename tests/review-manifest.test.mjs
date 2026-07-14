import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const writer = new URL("../scripts/write-review-manifest.mjs", import.meta.url);
const sanitizer = new URL("../scripts/sanitize-test-artifacts.mjs", import.meta.url);
const finalizer = new URL(
  "../scripts/finalize-review-manifest.mjs",
  import.meta.url,
);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const headSha = "a".repeat(40);
const testedMergeSha = "b".repeat(40);
const stagingSha = "c".repeat(40);
const buildTime = "2026-07-14T08:00:00Z";

function isolatedEnvironment(overrides = {}) {
  return {
    ...process.env,
    CI: "false",
    DATABASE_URL: "",
    GITHUB_HEAD_REF: "",
    GITHUB_REF_NAME: "",
    GITHUB_RUN_ID: "",
    NEXT_PUBLIC_APP_ENV: "",
    NEXT_PUBLIC_APP_VERSION: "",
    NEXT_PUBLIC_BUILD_TIME: "",
    REVIEW_ARTIFACT_DIGEST: "",
    REVIEW_ARTIFACT_ID: "",
    REVIEW_ARTIFACT_NAME: "",
    REVIEW_ARTIFACT_STATUS: "",
    REVIEW_BRANCH: "",
    REVIEW_COMMIT: "",
    REVIEW_EVENT_NAME: "",
    REVIEW_HEAD_SHA: "",
    REVIEW_STAGING_SHA: "",
    REVIEW_TESTED_MERGE_SHA: "",
    REVIEW_WORKFLOW_RUN_ID: "",
    ...overrides,
  };
}

function ciEnvironment(overrides = {}) {
  return isolatedEnvironment({
    CI: "true",
    NEXT_PUBLIC_APP_ENV: "test",
    NEXT_PUBLIC_APP_VERSION: "0.3.0-staging",
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    REVIEW_ARTIFACT_STATUS: "failure",
    REVIEW_BRANCH: "agent/auth-project-isolation",
    REVIEW_EVENT_NAME: "pull_request",
    REVIEW_HEAD_SHA: headSha,
    REVIEW_STAGING_SHA: stagingSha,
    REVIEW_TESTED_MERGE_SHA: testedMergeSha,
    REVIEW_WORKFLOW_RUN_ID: "29310000000",
    ...overrides,
  });
}

async function temporaryRoot() {
  return mkdtemp(path.join(os.tmpdir(), "projectai-review-manifest-test-"));
}

async function runWriter(root, env) {
  return execFileAsync(process.execPath, [writer.pathname], { cwd: root, env });
}

test("writes unambiguous PR provenance to evidence-index.json", async () => {
  const root = await temporaryRoot();
  try {
    await runWriter(root, ciEnvironment());
    const index = JSON.parse(
      await readFile(
        path.join(root, "review-artifacts/evidence-index.json"),
        "utf8",
      ),
    );
    assert.equal(index.headSha, headSha);
    assert.equal(index.testedMergeSha, testedMergeSha);
    assert.equal(index.stagingSha, stagingSha);
    assert.equal(index.branch, "agent/auth-project-isolation");
    assert.equal(index.workflowRunId, "29310000000");
    assert.equal(index.version, "0.3.0-staging");
    assert.equal(index.buildTime, buildTime);
    assert.equal(Object.hasOwn(index, "commit"), false);
    assert.equal(Object.hasOwn(index, "artifactId"), false);
    await assert.rejects(
      readFile(path.join(root, "review-artifacts/manifest.json")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses explicit null provenance for main push and local evidence", async () => {
  const pushRoot = await temporaryRoot();
  const localRoot = await temporaryRoot();
  try {
    await runWriter(
      pushRoot,
      ciEnvironment({
        REVIEW_BRANCH: "main",
        REVIEW_EVENT_NAME: "push",
        REVIEW_STAGING_SHA: "",
        REVIEW_TESTED_MERGE_SHA: "",
      }),
    );
    const pushIndex = JSON.parse(
      await readFile(
        path.join(pushRoot, "review-artifacts/evidence-index.json"),
        "utf8",
      ),
    );
    assert.equal(pushIndex.headSha, headSha);
    assert.equal(pushIndex.testedMergeSha, null);
    assert.equal(pushIndex.stagingSha, null);

    await runWriter(localRoot, isolatedEnvironment());
    const localIndex = JSON.parse(
      await readFile(
        path.join(localRoot, "review-artifacts/evidence-index.json"),
        "utf8",
      ),
    );
    assert.equal(localIndex.eventName, "local");
    assert.equal(localIndex.headSha, null);
    assert.equal(localIndex.testedMergeSha, null);
    assert.equal(localIndex.stagingSha, null);
    assert.equal(localIndex.workflowRunId, null);
    assert.equal(localIndex.branch, "local");
  } finally {
    await rm(pushRoot, { recursive: true, force: true });
    await rm(localRoot, { recursive: true, force: true });
  }
});

test("fails closed for missing, invalid, or legacy CI provenance", async (t) => {
  const cases = [
    ["eventName", { REVIEW_EVENT_NAME: "" }],
    ["headSha", { REVIEW_HEAD_SHA: "" }],
    ["testedMergeSha", { REVIEW_TESTED_MERGE_SHA: "" }],
    ["stagingSha", { REVIEW_STAGING_SHA: "not-a-sha" }],
    ["branch", { REVIEW_BRANCH: "" }],
    ["workflowRunId", { REVIEW_WORKFLOW_RUN_ID: "not-an-id" }],
    ["environment", { NEXT_PUBLIC_APP_ENV: "" }],
    ["version", { NEXT_PUBLIC_APP_VERSION: "" }],
    ["buildTime", { NEXT_PUBLIC_BUILD_TIME: "not-a-time" }],
    ["legacy commit", { REVIEW_COMMIT: headSha }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const root = await temporaryRoot();
      try {
        await assert.rejects(runWriter(root, ciEnvironment(overrides)));
        await assert.rejects(
          readFile(path.join(root, "review-artifacts/evidence-index.json")),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("publishes a separate authoritative manifest after payload upload", async () => {
  const root = await temporaryRoot();
  const artifactId = "8300999999";
  const artifactDigest = "d".repeat(64);
  try {
    const env = ciEnvironment({ REVIEW_STAGING_SHA: "" });
    await runWriter(root, env);
    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env,
    });
    await execFileAsync(process.execPath, [finalizer.pathname], {
      cwd: root,
      env: {
        ...env,
        GITHUB_RUN_ID: "29310000000",
        REVIEW_ARTIFACT_ID: artifactId,
        REVIEW_ARTIFACT_NAME: "product-review-evidence-29310000000-1",
        REVIEW_ARTIFACT_DIGEST: artifactDigest,
      },
    });
    const manifest = JSON.parse(
      await readFile(
        path.join(root, "product-review-manifest/manifest.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      {
        headSha: manifest.headSha,
        testedMergeSha: manifest.testedMergeSha,
        stagingSha: manifest.stagingSha,
        branch: manifest.branch,
        workflowRunId: manifest.workflowRunId,
        artifactId: manifest.artifactId,
        version: manifest.version,
        buildTime: manifest.buildTime,
      },
      {
        headSha,
        testedMergeSha,
        stagingSha: null,
        branch: "agent/auth-project-isolation",
        workflowRunId: "29310000000",
        artifactId,
        version: "0.3.0-staging",
        buildTime,
      },
    );
    assert.equal(manifest.artifactDigest, `sha256:${artifactDigest}`);
    assert.equal(Object.hasOwn(manifest, "commit"), false);
    await assert.rejects(
      readFile(
        path.join(
          root,
          "product-review-evidence/review-artifacts/manifest.json",
        ),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to publish provenance for invalid upload outputs", async (t) => {
  const cases = [
    ["missing artifact ID", { REVIEW_ARTIFACT_ID: "" }],
    ["invalid artifact ID", { REVIEW_ARTIFACT_ID: "artifact-1" }],
    ["wrong artifact name", { REVIEW_ARTIFACT_NAME: "unrelated-evidence" }],
    ["invalid digest", { REVIEW_ARTIFACT_DIGEST: "not-a-digest" }],
    ["different run", { GITHUB_RUN_ID: "29310000001" }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const root = await temporaryRoot();
      try {
        const env = ciEnvironment();
        await runWriter(root, env);
        await mkdir(path.join(root, "product-review-evidence"));
        await cp(
          path.join(root, "review-artifacts"),
          path.join(root, "product-review-evidence/review-artifacts"),
          { recursive: true },
        );
        await assert.rejects(
          execFileAsync(process.execPath, [finalizer.pathname], {
            cwd: root,
            env: {
              ...env,
              GITHUB_RUN_ID: "29310000000",
              REVIEW_ARTIFACT_ID: "8300999999",
              REVIEW_ARTIFACT_NAME:
                "product-review-evidence-29310000000-1",
              REVIEW_ARTIFACT_DIGEST: "d".repeat(64),
              ...overrides,
            },
          }),
        );
        await assert.rejects(
          readFile(path.join(root, "product-review-manifest/manifest.json")),
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("CI assigns the artifact ID only after uploading sanitized payload A", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github/workflows/ci.yml"),
    "utf8",
  );
  const writeIndex = workflow.indexOf("Write product review evidence index");
  const sanitize = workflow.indexOf("id: sanitize_evidence");
  const uploadPayload = workflow.indexOf("id: upload_evidence");
  const artifactIdOutput = workflow.indexOf(
    "steps.upload_evidence.outputs.artifact-id",
  );
  const finalizeManifest = workflow.indexOf("npm run review:finalize");
  const uploadManifest = workflow.indexOf(
    "Upload product review provenance manifest",
  );

  assert.ok(writeIndex >= 0);
  assert.ok(writeIndex < sanitize);
  assert.ok(sanitize < uploadPayload);
  assert.ok(uploadPayload < artifactIdOutput);
  assert.ok(artifactIdOutput < finalizeManifest);
  assert.ok(finalizeManifest < uploadManifest);
  assert.match(workflow, /tested_sha="\$\(git rev-parse HEAD\)"/);
  assert.doesNotMatch(workflow, /REVIEW_COMMIT:/);
  assert.doesNotMatch(workflow, /REVIEW_BUILD_TIME:/);
});
