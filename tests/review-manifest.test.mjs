import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { withDigest } from "../scripts/release/contract.mjs";
import { assertEvidenceIndex } from "../scripts/review-evidence-contract.mjs";

const execFileAsync = promisify(execFile);
const writer = new URL("../scripts/write-review-manifest.mjs", import.meta.url);
const sanitizer = new URL("../scripts/sanitize-test-artifacts.mjs", import.meta.url);
const finalizer = new URL(
  "../scripts/finalize-review-manifest.mjs",
  import.meta.url,
);
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const headSha = "a".repeat(40);
const testedSha = headSha;
const stagingSha = "c".repeat(40);
const buildTime = "2026-07-14T08:00:00Z";
const fullTestedUsers = [
  "system_admin",
  "project_manager_a",
  "project_member_a",
  "viewer_a",
];
const fullRoutes = {
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
const focusedTestedUsers = ["admin", "managerA", "viewerA", "outsider"];
const focusedRoutes = {
  assistantUi: "/assistant",
  projectDataSpaceUi: "/data-spaces/projects",
  companyDataSpaceUi: "/data-spaces/company",
  authApi: "/api/auth",
  assistantApi: "/api/ai",
  projectApi: "/api/projects",
  companyKnowledgeApi: "/api/company-knowledge",
};
const focusedScreenshots = [
  "screenshots/01-project-list.png",
  "screenshots/02-project-overview.png",
  "screenshots/03-project-files.png",
  "screenshots/04-session-empty.png",
  "screenshots/05-product-map-review.png",
  "screenshots/06-requirement-success-local-fake.png",
  "screenshots/08-ai-conversation.png",
  "screenshots/10-company-knowledge.png",
  "screenshots/11-company-upload-dialog.png",
  "screenshots/12-mobile-navigation-375.png",
];
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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
    REVIEW_EVIDENCE_PROFILE: "",
    REVIEW_HEAD_SHA: "",
    REVIEW_STAGING_SHA: "",
    REVIEW_TESTED_REF_TYPE: "",
    REVIEW_TESTED_SHA: "",
    REVIEW_WORKFLOW_RUN_ID: "",
    ...overrides,
  };
}

function ciEnvironment(overrides = {}) {
  return isolatedEnvironment({
    CI: "true",
    NEXT_PUBLIC_APP_ENV: "test",
    NEXT_PUBLIC_APP_VERSION: "0.6.0-staging",
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    REVIEW_ARTIFACT_STATUS: "failure",
    REVIEW_BRANCH: "agent/document-processing-index",
    REVIEW_EVENT_NAME: "pull_request",
    REVIEW_HEAD_SHA: headSha,
    REVIEW_STAGING_SHA: stagingSha,
    REVIEW_TESTED_REF_TYPE: "pull_request_head",
    REVIEW_TESTED_SHA: testedSha,
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

async function writeScreenshots(root, screenshots) {
  const screenshotsRoot = path.join(root, "review-artifacts/screenshots");
  await mkdir(screenshotsRoot, { recursive: true });
  await Promise.all(
    screenshots.map((filename) =>
      writeFile(path.join(root, "review-artifacts", filename), onePixelPng),
    ),
  );
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
    assert.equal(index.evidenceProfile, "full");
    assert.equal(index.testedSha, testedSha);
    assert.equal(index.testedRefType, "pull_request_head");
    assert.equal(index.stagingSha, stagingSha);
    assert.equal(index.branch, "agent/document-processing-index");
    assert.equal(index.workflowRunId, "29310000000");
    assert.equal(index.version, "0.6.0-staging");
    assert.equal(index.workerVersion, "1");
    assert.equal(index.parserVersion, "1");
    assert.equal(index.chunkerVersion, "1");
    assert.equal(index.aiGatewayVersion, "1");
    assert.equal(index.assistantProfileId, "qwen-project-assistant-cn-v2");
    assert.equal(index.retrievalProfileId, "hybrid-rrf-qwen37-v2");
    assert.equal(
      index.retrievalEvaluationDatasetVersion,
      "hybrid-retrieval-fictional-v1",
    );
    assert.deepEqual(index.retrievalReportFiles, []);
    assert.deepEqual(
      index.missingRetrievalReports,
      index.requiredRetrievalReports,
    );
    assert.deepEqual(index.releaseReportFiles, []);
    assert.deepEqual(index.missingReleaseReports, index.requiredReleaseReports);
    assert.equal(index.requiredRetrievalReports.length, 6);
    assert.equal(index.requiredReleaseReports.length, 20);
    assert.deepEqual(index.testedUsers, fullTestedUsers);
    assert.deepEqual(index.routes, fullRoutes);
    assert.deepEqual(index.screenshots, []);
    assert.equal(Object.hasOwn(index, "viewport"), false);
    assert.ok(index.requiredScreenshots.includes("screenshots/documents-empty.png"));
    assert.ok(
      index.requiredScreenshots.includes(
        "screenshots/document-upload-rejected.png",
      ),
    );
    assert.ok(
      index.requiredScreenshots.includes(
        "screenshots/knowledge-search-results.png",
      ),
    );
    assert.ok(
      index.requiredScreenshots.includes("screenshots/daily-report-confirmed.png"),
    );
    assert.equal(index.requiredScreenshots.length, 31);
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

test("publishes focused evidence from the users and route categories exercised by focused E2E", async () => {
  const root = await temporaryRoot();
  const artifactId = "8300888888";
  const artifactDigest = "e".repeat(64);
  const env = ciEnvironment({
    NEXT_PUBLIC_APP_VERSION: "0.8.0-staging",
    REVIEW_ARTIFACT_STATUS: "success",
    REVIEW_EVIDENCE_PROFILE: "focused-mvp",
  });
  try {
    await writeScreenshots(root, focusedScreenshots);
    await runWriter(root, env);
    const index = JSON.parse(
      await readFile(
        path.join(root, "review-artifacts/evidence-index.json"),
        "utf8",
      ),
    );
    assert.equal(index.evidenceProfile, "focused-mvp");
    assert.equal(index.testedSha, testedSha);
    assert.equal(index.testedRefType, "pull_request_head");
    assert.deepEqual(index.testedUsers, focusedTestedUsers);
    assert.deepEqual(index.routes, focusedRoutes);
    assert.deepEqual(index.requiredScreenshots, focusedScreenshots);
    assert.deepEqual(index.missingScreenshots, []);
    assert.equal(index.screenshotsComplete, true);
    assert.deepEqual(index.requiredRetrievalReports, []);
    assert.deepEqual(index.requiredReleaseReports, []);
    assert.equal(index.testedUsers.includes("memberA"), false);
    assert.equal(Object.hasOwn(index.routes, "dailyReport"), false);
    assert.doesNotThrow(() => assertEvidenceIndex(index, { ci: true }));

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
    assert.equal(manifest.evidenceProfile, "focused-mvp");
    assert.equal(manifest.testedSha, testedSha);
    assert.equal(manifest.testedRefType, "pull_request_head");
    assert.deepEqual(manifest.testedUsers, focusedTestedUsers);
    assert.deepEqual(manifest.routes, focusedRoutes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("focused contract and sanitizer independently reject user or route drift", async (t) => {
  const cases = [
    {
      name: "tested user drift",
      mutate(index) {
        index.testedUsers = [...focusedTestedUsers, "memberA"];
      },
      pattern: /invalid tested user set/i,
    },
    {
      name: "route drift",
      mutate(index) {
        index.routes = { ...focusedRoutes, dailyReport: "/daily-report" };
      },
      pattern: /invalid route set/i,
    },
  ];
  for (const { name, mutate, pattern } of cases) {
    await t.test(name, async () => {
      const root = await temporaryRoot();
      const env = ciEnvironment({
        REVIEW_EVIDENCE_PROFILE: "focused-mvp",
      });
      try {
        await runWriter(root, env);
        const indexPath = path.join(
          root,
          "review-artifacts/evidence-index.json",
        );
        const index = JSON.parse(await readFile(indexPath, "utf8"));
        mutate(index);
        assert.throws(() => assertEvidenceIndex(index, { ci: true }), pattern);
        await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
        await assert.rejects(
          execFileAsync(process.execPath, [sanitizer.pathname], {
            cwd: root,
            env,
          }),
          pattern,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test("indexes every CI Release JSON and Markdown digest with report identity", async () => {
  const root = await temporaryRoot();
  const image = `sha256:${"1".repeat(64)}`;
  const sessionId = `rs-${"2".repeat(32)}`;
  const reports = [
    ["release-database-rehearsal", "database-rehearsal", "b3-c1-v3"],
    ["release-disabled-image-rehearsal", "disabled-image", "b3-c1-v3"],
    ["release-smoke", "smoke", "b3-c1-v3"],
    ["production-authorization-contract", "production-authorization-contract", "b3-c2-v2"],
    ["production-phase-state-machine", "production-phase-state-machine", "b3-c2-v2"],
    ["production-rollout-rehearsal", "production-rollout-rehearsal", "b3-c2-v2"],
    ["production-rollout-rollback", "production-rollout-rollback", "b3-c2-v2"],
    ["production-rollout-resume", "production-rollout-resume", "b3-c2-v2"],
    ["production-compose-contract", "production-compose-contract", "b3-c2-v2"],
    ["production-secret-boundary", "production-secret-boundary", "b3-c2-v2"],
  ];
  try {
    await mkdir(path.join(root, "review-artifacts/screenshots"), { recursive: true });
    for (const [stem, reportType, producerVersion] of reports) {
      const report = withDigest({
        schemaVersion: 1,
        reportType,
        producer: "projectai-release-tool",
        producerVersion,
        sourceMode: "ci-artifact",
        releaseCandidateSha: headSha,
        releaseImageDigest: image,
        releaseSessionId: sessionId,
        passed: true,
      });
      await writeFile(
        path.join(root, `review-artifacts/${stem}.json`),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      await writeFile(
        path.join(root, `review-artifacts/${stem}.md`),
        `# ${reportType}\n\nDigest: ${report.digest}\n`,
      );
    }
    await runWriter(root, ciEnvironment({
      NEXT_PUBLIC_APP_VERSION: "0.8.0-staging",
      REVIEW_ARTIFACT_STATUS: "failure",
    }));
    const index = JSON.parse(await readFile(
      path.join(root, "review-artifacts/evidence-index.json"),
      "utf8",
    ));
    assert.equal(index.releaseReportDigests.length, 20);
    for (const entry of index.releaseReportDigests) {
      const contents = await readFile(path.join(root, "review-artifacts", entry.filename));
      const expectedFileDigest = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
      assert.equal(entry.sha256, expectedFileDigest);
      assert.equal(entry.releaseCandidateSha, headSha);
      assert.equal(entry.releaseImageDigest, image);
      assert.match(entry.reportDigest, /^sha256:[0-9a-f]{64}$/);
    }
    const driftedReleaseIndex = structuredClone(index);
    driftedReleaseIndex.releaseReportDigests[0].releaseCandidateSha =
      "b".repeat(40);
    assert.throws(
      () => assertEvidenceIndex(driftedReleaseIndex, { ci: true }),
      /Release report digest map is invalid/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses explicit tested-ref provenance for main push and local evidence", async () => {
  const pushRoot = await temporaryRoot();
  const localRoot = await temporaryRoot();
  try {
    await runWriter(
      pushRoot,
      ciEnvironment({
        REVIEW_BRANCH: "main",
        REVIEW_EVENT_NAME: "push",
        REVIEW_STAGING_SHA: "",
        REVIEW_TESTED_REF_TYPE: "push_head",
        REVIEW_TESTED_SHA: headSha,
      }),
    );
    const pushIndex = JSON.parse(
      await readFile(
        path.join(pushRoot, "review-artifacts/evidence-index.json"),
        "utf8",
      ),
    );
    assert.equal(pushIndex.headSha, headSha);
    assert.equal(pushIndex.testedSha, headSha);
    assert.equal(pushIndex.testedRefType, "push_head");
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
    assert.equal(localIndex.testedSha, null);
    assert.equal(localIndex.testedRefType, "local_worktree");
    assert.equal(localIndex.stagingSha, null);
    assert.equal(localIndex.workflowRunId, null);
    assert.equal(localIndex.branch, "local");
  } finally {
    await rm(pushRoot, { recursive: true, force: true });
    await rm(localRoot, { recursive: true, force: true });
  }
});

test("reads each PNG screenshot's actual dimensions instead of declaring a viewport", async () => {
  const root = await temporaryRoot();
  try {
    await mkdir(path.join(root, "review-artifacts/screenshots"), {
      recursive: true,
    });
    await writeFile(
      path.join(root, "review-artifacts/screenshots/login.png"),
      onePixelPng,
    );
    await runWriter(root, ciEnvironment());
    const index = JSON.parse(
      await readFile(
        path.join(root, "review-artifacts/evidence-index.json"),
        "utf8",
      ),
    );
    assert.deepEqual(index.screenshots, [
      { filename: "login.png", width: 1, height: 1 },
    ]);
    assert.equal(Object.hasOwn(index, "viewport"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed for missing, invalid, or legacy CI provenance", async (t) => {
  const cases = [
    ["eventName", { REVIEW_EVENT_NAME: "" }],
    ["headSha", { REVIEW_HEAD_SHA: "" }],
    ["testedSha", { REVIEW_TESTED_SHA: "" }],
    ["testedSha drift", { REVIEW_TESTED_SHA: "b".repeat(40) }],
    ["testedRefType", { REVIEW_TESTED_REF_TYPE: "" }],
    ["testedRefType drift", { REVIEW_TESTED_REF_TYPE: "push_head" }],
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
        testedSha: manifest.testedSha,
        testedRefType: manifest.testedRefType,
        stagingSha: manifest.stagingSha,
        branch: manifest.branch,
        workflowRunId: manifest.workflowRunId,
        artifactId: manifest.artifactId,
        version: manifest.version,
        buildTime: manifest.buildTime,
      },
      {
        headSha,
        testedSha,
        testedRefType: "pull_request_head",
        stagingSha: null,
        branch: "agent/document-processing-index",
        workflowRunId: "29310000000",
        artifactId,
        version: "0.6.0-staging",
        buildTime,
      },
    );
    assert.equal(manifest.artifactDigest, `sha256:${artifactDigest}`);
    assert.equal(manifest.workerVersion, "1");
    assert.equal(manifest.parserVersion, "1");
    assert.equal(manifest.chunkerVersion, "1");
    assert.equal(manifest.aiGatewayVersion, "1");
    assert.equal(
      manifest.assistantProfileId,
      "qwen-project-assistant-cn-v2",
    );
    assert.equal(manifest.retrievalProfileId, "hybrid-rrf-qwen37-v2");
    assert.equal(
      manifest.retrievalEvaluationDatasetVersion,
      "hybrid-retrieval-fictional-v1",
    );
    assert.deepEqual(manifest.retrievalReportFiles, []);
    assert.deepEqual(
      manifest.missingRetrievalReports,
      manifest.requiredRetrievalReports,
    );
    assert.deepEqual(manifest.releaseReportFiles, []);
    assert.deepEqual(
      manifest.missingReleaseReports,
      manifest.requiredReleaseReports,
    );
    assert.deepEqual(manifest.screenshots, []);
    assert.equal(Object.hasOwn(manifest, "viewport"), false);
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
  assert.match(workflow, /REVIEW_TESTED_SHA=\$tested_sha/);
  assert.match(workflow, /REVIEW_TESTED_REF_TYPE=\$tested_ref_type/);
  assert.doesNotMatch(workflow, /REVIEW_COMMIT:/);
  assert.doesNotMatch(workflow, /REVIEW_BUILD_TIME:/);
});

test("rejects the legacy merge-labelled field even when exact-head fields are valid", async () => {
  const root = await temporaryRoot();
  try {
    await runWriter(root, ciEnvironment());
    const index = JSON.parse(
      await readFile(
        path.join(root, "review-artifacts/evidence-index.json"),
        "utf8",
      ),
    );
    index.testedMergeSha = "b".repeat(40);
    assert.throws(
      () => assertEvidenceIndex(index, { ci: true }),
      /misleading testedMergeSha field is not allowed/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
