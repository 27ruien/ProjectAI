import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("AI workflow UI exposes exactly the two approved user workflows", async () => {
  const [home, workspace, sidebar, meeting, requirement, stagingUat] = await Promise.all([
    read("components/workflow/workflows-page.tsx"),
    read("components/workspace.tsx"),
    read("components/layout/sidebar.tsx"),
    read("components/workflow/meeting-minutes-page.tsx"),
    read("components/workflow/requirement-framework-page.tsx"),
    read("tests/product-v2-staging-e2e/product-v2.spec.ts"),
  ]);
  assert.match(home, /搭建需求框架/);
  assert.match(home, /提取会议纪要/);
  for (const internal of ["Scope 对比", "Action Plan", "Risk", "周报", "需求提取"]) assert.doesNotMatch(home, new RegExp(`title: ["']${internal}`));
  assert.match(workspace, /requirement-framework/);
  assert.match(workspace, /meeting-minutes/);
  assert.match(meeting, /action: "retry"/);
  assert.match(meeting, /从失败步骤重试/);
  assert.match(meeting, /setMessage\(error instanceof Error \? error\.message : "会议纪要发布失败"\)/);
  assert.match(meeting, /setMessage\(error instanceof Error \? error\.message : "原始音视频删除失败"\)/);
  assert.match(meeting, /正在发布…/);
  assert.match(meeting, /正在删除…/);
  assert.doesNotMatch(meeting, /setMessage\(next\.run\.failureCode \?/);
  assert.doesNotMatch(requirement, /else setMessage\(""\);/);
  assert.doesNotMatch(sidebar, /href: "\/(?:skills|reviews|uat)/);
  assert.match(stagingUat, /@requirement-workflow/);
  assert.match(stagingUat, /@meeting-workflow/);
  assert.match(stagingUat, /STAGING_MEETING_AUDIO_PATH_REQUIRED/);
  assert.match(stagingUat, /真实 ASR|real ASR/);
  assert.doesNotMatch(stagingUat, /Requirement Extraction uploads/);
  assert.doesNotMatch(stagingUat, /生成待审核草稿/);
});

test("workflow persistence uses compound isolation, leases, provenance, and human review", async () => {
  const [schema, service, worker, authorization, requirementPage, migration] = await Promise.all([
    read("lib/db/schema/workflows.ts"),
    read("lib/workflows/service.ts"),
    read("lib/workflows/worker.ts"),
    read("lib/workflows/authorization.ts"),
    read("components/workflow/requirement-framework-page.tsx"),
    read("drizzle/0028_open_dracula.sql"),
  ]);
  for (const entity of ["workflowDefinition", "workflowRun", "workflowRunSource", "workflowArtifact", "workflowArtifactVersion", "workflowReview", "workflowExecution", "workflowExport", "workflowAudioJob", "transcriptSpeaker", "transcriptSegment"]) assert.match(schema, new RegExp(`export const ${entity}`));
  assert.match(schema, /workflow_runs_project_organization_fk/);
  assert.match(schema, /workflow_runs_project_department_fk/);
  assert.match(schema, /workflow_run_sources_version_document_project_fk/);
  assert.match(schema, /sourceProjectId/);
  assert.match(schema, /nextAttemptAt/);
  assert.match(service, /listAuthorizedDocumentScope/);
  assert.match(service, /expectedVersion/);
  assert.match(service, /decision: "request_changes" \| "approve" \| "publish"/);
  assert.match(worker, /for update skip locked/);
  assert.match(worker, /WORKFLOW_PROVIDER_RESULT_UNKNOWN/);
  assert.match(worker, /WORKFLOW_LEASE_EXPIRED_RECOVERED/);
  assert.match(worker, /nextAttemptAt: sql`now\(\) \+ interval '10 seconds'`/);
  assert.match(worker, /if \(!run\) \{[\s\S]*?await wait\(workerConfig\.pollMs, options\.signal\);[\s\S]*?writeFile\(workerConfig\.heartbeatFile/);
  const parenthesizedExpiryGuard = /sql`\(\$\{workflowRunSource\.expiresAt\} is null or \$\{workflowRunSource\.expiresAt\} > now\(\)\)`/g;
  assert.equal(authorization.match(parenthesizedExpiryGuard)?.length, 2);
  assert.equal(worker.match(parenthesizedExpiryGuard)?.length, 1);
  assert.doesNotMatch(authorization, /sql`\$\{workflowRunSource\.expiresAt\} is null or/);
  assert.doesNotMatch(worker, /sql`\$\{workflowRunSource\.expiresAt\} is null or/);
  assert.match(requirementPage, /disabled=\{loading \|\| destinations\.length === 0\}/);
  assert.match(migration, /workflow_runs_project_organization_fk/);
});

test("Staging gives Qwen and audio capability only to the app and workflow worker", async () => {
  const [compose, deploy, audioUploadRoute, audioService, nextConfig, fixtureProjectRoute, meetingPage] = await Promise.all([
    read("docker-compose.staging.yml"),
    read("scripts/deploy-product-v2-staging.sh"),
    read("app/api/projects/[projectId]/workflows/meeting-minutes/route.ts"),
    read("lib/workflows/audio-service.ts"),
    read("next.config.ts"),
    read("app/api/test-fixtures/projects/route.ts"),
    read("components/workflow/meeting-minutes-page.tsx"),
  ]);
  assert.match(compose, /projectai-workflow-worker:/);
  assert.match(compose, /AUDIO_DOWNLOAD_SIGNING_KEY_FILE: \/run\/secrets\/audio_download_signing_key/);
  assert.match(compose, /project-ai-os-staging-workflow-worker/);
  assert.match(deploy, /STAGING_WORKFLOW_WORKER_IMAGE/);
  assert.match(deploy, /openssl rand -base64 48/);
  assert.match(deploy, /install -m 0600 -o 1000 -g 1000 "\$secret_temp" "\$audio_signing_secret_file"/);
  assert.match(deploy, /chown 1000:1000 "\$audio_signing_secret_file"/);
  assert.match(deploy, /1000:1000:600/);
  assert.match(deploy, /project-ai-os-staging-workflow-worker/);
  assert.match(audioUploadRoute, /allowedMediaTypes: \["multipart\/form-data"\]/);
  assert.match(nextConfig, /serverActions: \{ bodySizeLimit: "52mb" \}/);
  assert.match(audioService, /MAX_AUDIO_BYTES = 50 \* 1024 \* 1024/);
  assert.match(meetingPage, /maxAudioBytes = 50 \* 1024 \* 1024/);
  assert.match(fixtureProjectRoute, /V3 Requirement UAT \[a-f0-9\]\{8\}/);
  assert.match(fixtureProjectRoute, /V3 Meeting UAT \[a-f0-9\]\{8\}/);
  assert.match(compose, /arn:aws:s3:::.*\/projects\/\*/);
  assert.match(audioService, /`projects\/\$\{target\.id\}\/workflow-audio\/\$\{runId\}\//);
  assert.doesNotMatch(audioService, /`workflow-audio\//);
  assert.doesNotMatch(compose.match(/\n  projectai-document-worker:\n[\s\S]*?\n  projectai-embedding-worker:\n/)?.[0] ?? "", /qwen_api_key|audio_download_signing_key/);
});

test("workflow failures preserve only controlled validation codes", async () => {
  const worker = await read("lib/workflows/worker.ts");
  assert.match(worker, /throw new WorkflowError\(422, failureCode, message\)/u);
  assert.match(worker, /failArtifactStep\(run\.projectId, executionId, failureCode/u);
  assert.doesNotMatch(
    worker,
    /failureCode, completedAt: new Date\(\) \}\)\.where\(eq\(workflowExecution\.id, executionId\)\);\s*throw new WorkflowError\(422, "WORKFLOW_AI_OUTPUT_INVALID"/u,
  );
});
