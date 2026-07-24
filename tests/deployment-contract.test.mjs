import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { normalizeApplicationCookieName } from "../scripts/lib/cookie-name.mjs";

const execFileAsync = promisify(execFile);
const deployScript = new URL("../scripts/deploy-staging.sh", import.meta.url);
const stagingCompose = new URL("../docker-compose.staging.yml", import.meta.url);
const productionCompose = new URL("../docker-compose.prod.yml", import.meta.url);
const productionRolloutCompose = new URL(
  "../docker-compose.production-rollout.yml",
  import.meta.url,
);
const productionAiCompose = new URL(
  "../docker-compose.production-ai.yml",
  import.meta.url,
);
const productionRolloutOperations = new URL(
  "../scripts/release/production-rollout-operations.sh",
  import.meta.url,
);
const ciWorkflow = new URL("../.github/workflows/ci.yml", import.meta.url);
const stagingNginx = new URL(
  "../deploy/nginx-projectai-staging.conf",
  import.meta.url,
);
const authBoundaryVerifier = new URL(
  "../scripts/verify-auth-boundaries.mjs",
  import.meta.url,
);
const groundedAiVerifier = new URL(
  "../scripts/verify-grounded-ai-flow.ts",
  import.meta.url,
);
const fileStorageVerifier = new URL(
  "../scripts/verify-file-storage-flow.ts",
  import.meta.url,
);
const requestProxy = new URL("../proxy.ts", import.meta.url);
const environmentBanner = new URL(
  "../components/layout/environment-banner.tsx",
  import.meta.url,
);

function serviceBlock(compose, service, nextService) {
  const pattern = new RegExp(
    `\\n  ${service}:\\n([\\s\\S]*?)\\n  ${nextService}:`,
  );
  const match = compose.match(pattern);
  assert.ok(match, `missing Compose service ${service}`);
  return match[1];
}

test("Staging PostgreSQL readiness checks the final TCP listener", async () => {
  const [script, compose] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
  ]);
  const readinessLine = compose
    .split("\n")
    .find((line) => line.includes("pg_isready"));
  assert.ok(readinessLine);
  assert.match(readinessLine, /pg_isready -h 127\.0\.0\.1/);
  assert.match(readinessLine, /\$\$\{POSTGRES_USER\}/);
  assert.match(readinessLine, /\$\$\{POSTGRES_DB\}/);
  assert.match(
    script,
    /PGPASSWORD="\$POSTGRES_PASSWORD" psql \\\n+\s+--host=127\.0\.0\.1/,
  );
});

test("B3-C2A Production Compose is private, immutable, scoped, and never uses compose down", async () => {
  const [compose, aiCompose, operations] = await Promise.all([
    readFile(productionRolloutCompose, "utf8"),
    readFile(productionAiCompose, "utf8"),
    readFile(productionRolloutOperations, "utf8"),
  ]);
  assert.match(compose, /^name: projectai-production$/m);
  assert.match(compose, /127\.0\.0\.1:3100:3000/);
  assert.match(compose, /pgvector\/pgvector:0\.8\.1-pg17@sha256:/);
  assert.match(compose, /quay\.io\/minio\/minio:RELEASE\.[^\s]+@sha256:/);
  assert.doesNotMatch(compose, /image:\s*[^\n]*:latest\b/);
  for (const service of ["projectai-postgres", "projectai-minio"]) {
    const block = serviceBlock(
      compose,
      service,
      service === "projectai-postgres" ? "projectai-minio" : "projectai-minio-init",
    );
    assert.doesNotMatch(block, /^\s+ports:/m);
  }
  assert.match(aiCompose, /projectai-app:[\s\S]+qwen_api_key/);
  assert.match(aiCompose, /projectai-embedding-worker:[\s\S]+qwen_api_key/);
  assert.doesNotMatch(compose.match(/projectai-document-worker:[\s\S]+?projectai-embedding-worker:/)?.[0] ?? "", /qwen_api_key/);
  assert.match(compose, /admin policy attach admin projectai-production-files/);
  assert.match(compose, /projectai-production-files\/projects\/\*/);
  const app = serviceBlock(compose, "projectai-app", "projectai-document-worker");
  const document = serviceBlock(compose, "projectai-document-worker", "projectai-embedding-worker");
  const embedding = serviceBlock(compose, "projectai-embedding-worker", "projectai-postgres");
  assert.match(app, /projectai-production-egress/);
  assert.match(embedding, /projectai-production-egress/);
  assert.doesNotMatch(document, /projectai-production-egress/);
  assert.match(document, /\.env\.embedding-production/);
  assert.doesNotMatch(document, /qwen_api_key/);
  assert.match(compose, /projectai-production-internal:[\s\S]+internal: true/);
  assert.match(operations, /PROJECTAI_PRODUCTION_ROLLOUT_EXECUTION_ENABLED/);
  assert.doesNotMatch(operations, /docker compose down|compose down/);
  assert.doesNotMatch(operations, /printenv|\.Config\.Env/);
  await execFileAsync("bash", ["-n", productionRolloutOperations.pathname]);
});

test("Staging MinIO is pinned, private, persistent, and resource bounded", async () => {
  const compose = await readFile(stagingCompose, "utf8");
  const minio = serviceBlock(compose, "projectai-minio", "projectai-minio-init");
  assert.match(minio, /quay\.io\/minio\/minio:RELEASE\.[0-9TZ-]+/);
  assert.doesNotMatch(minio, /:latest\b/);
  assert.match(minio, /container_name: project-ai-os-staging-minio/);
  assert.match(minio, /MINIO_ROOT_USER/);
  assert.match(minio, /MINIO_ROOT_PASSWORD/);
  assert.match(minio, /projectai-staging-minio:\/data/);
  assert.match(minio, /projectai-staging-internal/);
  assert.match(minio, /\/minio\/health\/live/);
  assert.match(minio, /cpus: 1\.0/);
  assert.match(minio, /mem_limit: 768m/);
  assert.match(minio, /pids_limit: 256/);
  assert.doesNotMatch(minio, /^\s+ports:/m);
  assert.match(
    compose,
    /projectai-staging-minio:\n\s+name: projectai-staging-minio/,
  );
});

test("MinIO initialization is idempotent, private, and least privileged", async () => {
  const compose = await readFile(stagingCompose, "utf8");
  const init = serviceBlock(compose, "projectai-minio-init", "projectai-migrate");
  const migrate = serviceBlock(compose, "projectai-migrate", "projectai-storage-ops");
  const appMatch = compose.match(
    /\n  projectai-staging:\n([\s\S]*?)\n  projectai-document-worker:/,
  );
  assert.ok(appMatch, "missing Compose service projectai-staging");
  const app = appMatch[1];
  assert.match(init, /quay\.io\/minio\/mc:RELEASE\.[0-9TZ-]+/);
  assert.match(init, /mb --ignore-existing/);
  assert.match(init, /anonymous set none/);
  assert.match(init, /admin user add/);
  assert.match(init, /admin policy attach/);
  assert.match(init, /arn:aws:s3:::[^\n]+\/projects\/\*/);
  assert.match(init, /condition: service_healthy/);
  assert.match(app, /condition: service_completed_successfully/);
  assert.match(app, /OBJECT_STORAGE_ACCESS_KEY/);
  assert.match(app, /OBJECT_STORAGE_SECRET_KEY/);
  assert.doesNotMatch(app, /MINIO_ROOT_(?:USER|PASSWORD)/);
  assert.doesNotMatch(migrate, /MINIO_ROOT_|OBJECT_STORAGE_/);
});

test("pre-migration PostgreSQL backup streams and validates a custom archive", async () => {
  const script = await readFile(deployScript, "utf8");
  const dumpBlock = script.match(
    /PGPASSWORD="\$POSTGRES_PASSWORD" pg_dump[\s\S]+?' \| sudo tee "\$partial_backup"/,
  )?.[0];
  assert.ok(dumpBlock);
  assert.match(dumpBlock, /--format=custom/);
  assert.match(dumpBlock, /--host=127\.0\.0\.1/);
  assert.doesNotMatch(dumpBlock, /--file(?:=|\s)/);
  assert.match(script, /pg_restore --list/);
  assert.match(script, /chmod 600 "\$host_backup"/);
});

test("MinIO backup uses inventory, atomic mirror validation, and an isolated restore drill", async () => {
  const script = await readFile(deployScript, "utf8");
  assert.match(script, /Stopping the Staging application and both Workers briefly for a cross-store snapshot/);
  assert.match(script, /projectai-staging-objects-\$\{backup_timestamp\}-\$\{commit_sha\}/);
  assert.match(script, /inventory_name="\$\{object_backup_stem\}\.inventory\.jsonl"/);
  assert.match(script, /inventory_partial="\$\{object_backup_root\}\/\$\{inventory_name\}\.partial"/);
  assert.match(script, /mirror_name="\$\{object_backup_stem\}\.mirror"/);
  assert.match(script, /mirror_partial="\$\{object_backup_root\}\/\$\{mirror_name\}\.partial"/);
  assert.match(script, /mc --json[\s\S]+?ls --recursive/);
  assert.match(script, /mc --quiet[\s\S]+?mirror --retry/);
  assert.match(script, /mirror_count[\s\S]+?inventory_count/);
  assert.match(script, /mirror_bytes[\s\S]+?inventory_bytes/);
  assert.match(script, /sudo mv "\$inventory_partial" "\$inventory_backup"/);
  assert.match(script, /sudo mv "\$mirror_partial" "\$mirror_backup"/);
  assert.match(script, /projectai-restore-\$\{commit_sha:0:12\}/);
  assert.match(script, /\[ "\$RESTORE_BUCKET" != "\$OBJECT_STORAGE_BUCKET" \]/);
  const restoreDrill = script.match(
    /printf 'Restoring the MinIO mirror[\s\S]+?Staging MinIO isolated restore drill failed/,
  )?.[0];
  assert.ok(restoreDrill);
  assert.match(restoreDrill, /mc --json[\s\S]+?du "admin\/\$RESTORE_BUCKET"/);
  assert.match(restoreDrill, /restored_count[\s\S]+?EXPECTED_COUNT/);
  assert.match(restoreDrill, /restored_bytes[\s\S]+?EXPECTED_BYTES/);
  assert.doesNotMatch(restoreDrill, /\bawk\b/);
  assert.match(script, /rb --force "admin\/\$RESTORE_BUCKET"/);
  assert.match(script, /A partial Staging MinIO backup remains after validation/);
  assert.match(script, /minio_backup_env="\$\(sudo mktemp/);
  assert.match(script, /chmod 600 "\$minio_backup_env"/);
  assert.match(script, /printf 'MINIO_ROOT_USER=%s\\n'/);
  assert.match(script, /printf 'OBJECT_STORAGE_BUCKET=%s\\n'/);
  assert.match(script, /sudo rm -f -- "\$minio_backup_env"/);
  assert.match(script, /trap cleanup_minio_backup_env EXIT/);
  const backupRun = script.match(/minio_backup_run=\([\s\S]*?\n\)/)?.[0];
  assert.ok(backupRun);
  assert.match(backupRun, /--env-file "\$minio_backup_env"/);
  assert.doesNotMatch(backupRun, /--env-file "\$env_file"/);
  assert.doesNotMatch(backupRun, /--env MINIO_ROOT_USER/);
  assert.doesNotMatch(backupRun, /--env OBJECT_STORAGE_BUCKET/);
});

test("operations use scoped Compose services and storage verification stays read-only", async () => {
  const [script, compose] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
  ]);
  const storageOps = serviceBlock(
    compose,
    "projectai-storage-ops",
    "projectai-file-smoke",
  );
  const composeRun = script.match(/compose_run=\([\s\S]*?\n\)/)?.[0];
  assert.ok(composeRun);
  assert.match(composeRun, /--interactive=false/);
  assert.match(composeRun, /--no-TTY/);
  assert.match(composeRun, /timeout/);
  assert.match(composeRun, /--signal=TERM/);
  assert.match(composeRun, /--kill-after=30s/);
  assert.match(composeRun, /45m/);
  assert.match(script, /compose_run=\(/);
  assert.match(script, /--no-deps/);
  assert.match(script, /--pull never/);
  assert.match(script, /projectai-migrate npm run db:migrate/);
  assert.match(script, /projectai-migrate npm run db:seed/);
  assert.equal(
    [...script.matchAll(/projectai-storage-ops npm run storage:verify/g)].length,
    4,
  );
  assert.doesNotMatch(script, /storage:reconcile[^\n]*--apply/);
  assert.match(storageOps, /OBJECT_STORAGE_ENDPOINT/);
  assert.match(storageOps, /OBJECT_STORAGE_SECRET_KEY/);
  assert.doesNotMatch(storageOps, /MINIO_ROOT_/);
  const fileSmoke = serviceBlock(
    compose,
    "projectai-file-smoke",
    "projectai-document-smoke",
  );
  const documentSmoke = serviceBlock(
    compose,
    "projectai-document-smoke",
    "projectai-ai-smoke",
  );
  const aiSmoke = serviceBlock(
    compose,
    "projectai-ai-smoke",
    "projectai-staging",
  );
  assert.match(fileSmoke, /SEED_MANAGER_A_EMAIL/);
  assert.match(fileSmoke, /SEED_MANAGER_A_PASSWORD/);
  assert.doesNotMatch(fileSmoke, /MINIO_ROOT_/);
  assert.match(documentSmoke, /SEED_MANAGER_A_EMAIL/);
  assert.match(documentSmoke, /SEED_MANAGER_A_PASSWORD/);
  assert.match(documentSmoke, /SEED_VIEWER_A_EMAIL/);
  assert.match(documentSmoke, /SEED_VIEWER_A_PASSWORD/);
  assert.match(documentSmoke, /<<: \[\*document-processing-environment, \*embedding-environment\]/);
  assert.match(documentSmoke, /mem_limit: 768m/);
  assert.doesNotMatch(documentSmoke, /MINIO_ROOT_/);
  assert.match(aiSmoke, /SEED_MANAGER_A_EMAIL/);
  assert.match(aiSmoke, /SEED_VIEWER_A_EMAIL/);
  assert.match(aiSmoke, /npm run assistant:smoke/);
  assert.doesNotMatch(aiSmoke, /QWEN_|qwen_api_key|secrets:/);
  assert.equal(
    [...script.matchAll(/projectai-file-smoke npm run storage:smoke/g)].length,
    2,
  );
  assert.equal(
    [...script.matchAll(/projectai-document-smoke npm run documents:smoke/g)]
      .length,
    2,
  );
  assert.equal(
    [
      ...script.matchAll(
        /projectai-document-smoke npm run documents:lease-smoke/g,
      ),
    ].length,
    1,
  );
  assert.equal(
    [...script.matchAll(/projectai-ai-smoke npm run assistant:smoke/g)].length,
    5,
  );
  assert.equal(
    [...script.matchAll(/projectai-document-smoke npm run embeddings:smoke:prepare/g)].length,
    1,
  );
  assert.equal(
    [...script.matchAll(/projectai-document-smoke npm run embeddings:lease-smoke/g)].length,
    1,
  );
  assert.equal(
    [...script.matchAll(/projectai-document-smoke npm run embeddings:smoke:verify/g)].length,
    1,
  );
  assert.match(script, /real Staging upload, download integrity, versioning, and lifecycle cleanup/);
  assert.match(script, /six-format document processing, lexical search, citations, permissions, and cleanup/);
  assert.match(script, /real Staging Qwen grounding, citations, private Threads, Viewer access, Token Usage, Audit, and cleanup/);
  assert.match(script, /Stopping the document Worker for exclusive Lease recovery verification/);
  assert.match(script, /Restarting the document Worker after Lease verification/);
  assert.match(script, /status in \(\$1, \$2\)/);
  assert.match(script, /! -name 'projectai-document-worker-heartbeat'/);
  assert.match(
    script,
    /APP_BASE_URL=\$public_base_url[\s\S]+?projectai-file-smoke npm run storage:smoke/,
  );
  assert.match(
    script,
    /APP_BASE_URL=\$public_base_url[\s\S]+?projectai-document-smoke npm run documents:smoke/,
  );
  const publicVerification = script.match(
    /<<'REMOTE_PUBLIC_AUTH'[\s\S]+?\nREMOTE_PUBLIC_AUTH/,
  )?.[0];
  assert.ok(publicVerification);
  assert.match(publicVerification, /cd "\$remote_dir"/);
  assert.match(publicVerification, /--interactive=false/);
  assert.match(publicVerification, /--no-TTY/);
  assert.match(
    publicVerification,
    /projectai-file-smoke npm run storage:smoke[\s\S]+?projectai-document-smoke npm run documents:smoke[\s\S]+?projectai-storage-ops npm run storage:verify/,
  );
  assert.match(script, /sudo nginx -T 2>\/dev\/null/);
  assert.match(script, /client_max_body_size 52m/);
});

test("Staging deployment bounds remote operations and keeps SSH sessions alive", async () => {
  const script = await readFile(deployScript, "utf8");
  assert.match(script, /command -v timeout >\/dev\/null 2>&1/);
  assert.match(script, /ServerAliveInterval=15/);
  assert.match(script, /ServerAliveCountMax=12/);
  assert.match(script, /ConnectTimeout=10/);
  assert.match(
    script,
    /--rsh='ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12 -o ConnectTimeout=10'/,
  );
  assert.equal(
    [...script.matchAll(/--kill-after=30s\n\s+45m/g)].length,
    2,
  );
});

test("rollback preserves the previous application health contract", async () => {
  const script = await readFile(deployScript, "utf8");
  const captureBlock = script.match(
    /PREVIOUS_STAGING_STATE=[\s\S]+?REMOTE_IMAGE\n\)/,
  )?.[0];
  assert.ok(captureBlock);
  assert.match(captureBlock, /STAGING_HEALTHCHECK_PATH=/);
  assert.match(captureBlock, /NEXT_PUBLIC_COMMIT_SHA=/);
  assert.match(captureBlock, /NEXT_PUBLIC_APP_VERSION=/);
  assert.match(captureBlock, /NEXT_PUBLIC_BUILD_TIME=/);
  assert.match(captureBlock, /worker_container_name/);
  assert.match(captureBlock, /worker_image/);
  assert.match(captureBlock, /embedding_worker_container_name/);
  assert.match(captureBlock, /embedding_worker_image/);
  assert.match(captureBlock, /embedding_worker_running/);
  assert.match(captureBlock, /running.*healthy/);
  assert.match(script, /rollback_health_path="\$previous_health_path"/);
  const rollbackBlock = script.match(
    /<<'REMOTE_ROLLBACK'[\s\S]+?\nREMOTE_ROLLBACK/,
  )?.[0];
  assert.ok(rollbackBlock);
  assert.match(rollbackBlock, /NEXT_PUBLIC_COMMIT_SHA=\$previous_commit_sha/);
  assert.match(rollbackBlock, /NEXT_PUBLIC_APP_VERSION=\$previous_app_version/);
  assert.match(rollbackBlock, /NEXT_PUBLIC_BUILD_TIME=\$previous_build_time/);
  assert.match(rollbackBlock, /STAGING_WORKER_IMAGE=/);
  assert.match(rollbackBlock, /STAGING_EMBEDDING_WORKER_IMAGE=/);
  assert.match(rollbackBlock, /projectai-document-worker/);
  assert.match(rollbackBlock, /projectai-embedding-worker/);
  assert.match(
    script,
    /\$\{PREVIOUS_STAGING_WORKER_IMAGE:-__projectai_empty__\}/,
  );
  assert.match(
    rollbackBlock,
    /previous_worker_image" != "__projectai_empty__"/,
  );
  assert.match(
    rollbackBlock,
    /previous_embedding_worker_image" != "__projectai_empty__"/,
  );
  assert.doesNotMatch(rollbackBlock, /NEXT_PUBLIC_COMMIT_SHA=\$commit_sha/);
  assert.match(rollbackBlock, /restored_environment=/);
  assert.match(script, /rm --stop --force projectai-minio-init/);
});

test("Staging deployment retains Production and named-volume safety boundaries", async () => {
  const [script, production] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(productionCompose, "utf8"),
  ]);
  assert.match(script, /DEFAULT_EXPECTED_BRANCH="agent\/phase1-project-knowledge-management"/);
  assert.match(
    script,
    /EXPECTED_BRANCH="\$\{PROJECTAI_STAGING_DEPLOY_BRANCH:-\$DEFAULT_EXPECTED_BRANCH\}"/,
  );
  assert.match(script, /PROJECTAI_STAGING_DEPLOY_BRANCH must name an agent branch/);
  assert.ok(script.includes("--filter='protect /.local/***'"));
  assert.ok(script.includes("--exclude '/.local/'"));
  assert.match(script, /REMOTE_DIR must remain isolated at \/srv\/projectai-staging/);
  assert.match(script, /PRODUCTION_STATE_BEFORE/);
  assert.match(script, /production_state_after.*PRODUCTION_STATE_BEFORE/s);
  assert.match(script, /Production changed before the Staging transaction could commit/);
  assert.doesNotMatch(script, /docker compose down/);
  assert.doesNotMatch(script, /docker volume rm/);
  assert.doesNotMatch(script, /projectai-staging-minio[^\n]*(?:volume rm|down -v)/);
  assert.doesNotMatch(production, /projectai-minio|MINIO_ROOT_|OBJECT_STORAGE_/);
});

test("CI MinIO uses random masked credentials, a private tmpfs, and always cleans up", async () => {
  const workflow = await readFile(ciWorkflow, "utf8");
  assert.match(workflow, /uses: actions\/checkout@v7\n\s+with:\n\s+fetch-depth: 0/);
  assert.match(workflow, /uses: actions\/setup-node@v7/);
  assert.match(workflow, /uses: actions\/upload-artifact@v7/);
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node|upload-artifact)@v4/);
  assert.match(workflow, /Start isolated MinIO with ephemeral credentials/);
  assert.match(workflow, /openssl rand -hex 32/);
  assert.match(workflow, /::add-mask::\$secret/);
  assert.match(workflow, /quay\.io\/minio\/minio:RELEASE\./);
  assert.match(workflow, /quay\.io\/minio\/mc:RELEASE\./);
  assert.match(workflow, /--tmpfs \/data:rw,noexec,nosuid,nodev,size=512m/);
  assert.match(workflow, /--publish 127\.0\.0\.1:9000:9000/);
  assert.match(workflow, /anonymous set none/);
  assert.match(workflow, /anonymous_code[\s\S]+?== "403"/);
  assert.match(workflow, /npm run test:storage/);
  assert.match(workflow, /npm run test:documents/);
  assert.match(workflow, /npm run test:document-integration/);
  assert.match(workflow, /npm run test:cleanup/);
  assert.match(workflow, /npm run storage:verify/);
  assert.match(workflow, /npm run storage:reconcile/);
  assert.match(workflow, /npm run test:release/);
  assert.match(workflow, /npm run release:database-rehearsal/);
  assert.match(workflow, /scripts\/release\/disabled-image-rehearsal\.sh/);
  assert.match(workflow, /RELEASE_CANDIDATE_SHA/);
  assert.match(workflow, /git cat-file -e "\$\{RELEASE_CANDIDATE_SHA\}\^\{commit\}"/);
  assert.match(workflow, /git worktree add --detach "\$release_tree" "\$RELEASE_CANDIDATE_SHA"/);
  assert.match(workflow, /npm run release:report/);
  assert.match(workflow, /write-ci-smoke-tsv\.mjs/);
  assert.match(workflow, /--kind=smoke/);
  assert.match(workflow, /npm run release:session/);
  assert.doesNotMatch(workflow, /gridworks\.cn[\s\S]*release:database-rehearsal/);
  assert.match(workflow, /Destroy isolated CI MinIO\n\s+if: always\(\)/);
  assert.match(workflow, /docker rm --force "\$container"/);
  assert.match(workflow, /docker network rm "\$network"/);
  assert.doesNotMatch(workflow, /OBJECT_STORAGE_ENDPOINT=.*gridworks\.cn/);
  assert.doesNotMatch(workflow, /STAGING_HEALTH_URL|projectai-staging\/api\/health/);
});

test("disabled release image rehearsal is provider-neutral with a bounded health deadline", async () => {
  const script = await readFile(
    new URL("../scripts/release/disabled-image-rehearsal.sh", import.meta.url),
    "utf8",
  );
  assert.match(script, /--env AI_ASSISTANT_ENABLED=false/);
  assert.match(script, /--env AI_EMBEDDING_ENABLED=false/);
  assert.match(script, /--env AI_ASSISTANT_RETRIEVAL_MODE=lexical/);
  assert.doesNotMatch(script, /--env AI_(?:EMBEDDING_)?PROVIDER=fake/);
  assert.match(script, /for _ in \{1\.\.45\}; do/);
  assert.match(script, /before the 90-second deadline/);
  assert.match(script, /\.State\.Status/);
  assert.match(script, /\.State\.ExitCode/);
  assert.match(script, /\.State\.OOMKilled/);
  assert.match(script, /\.RestartCount/);
  assert.doesNotMatch(script, /docker logs/);
});

test("Staging document Worker is isolated, bounded, healthy, and uses the immutable app image", async () => {
  const [script, compose, dockerfile] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  ]);
  const workerMatch = compose.match(
    /\n  projectai-document-worker:\n([\s\S]*?)\n  projectai-embedding-worker:/,
  );
  assert.ok(workerMatch, "missing Compose service projectai-document-worker");
  const worker = workerMatch[1];
  assert.match(worker, /container_name: project-ai-os-staging-worker/);
  assert.match(worker, /STAGING_WORKER_IMAGE/);
  assert.match(worker, /npm[\s\S]+worker:documents/);
  assert.match(worker, /restart: unless-stopped/);
  assert.match(worker, /stop_grace_period: 30s/);
  assert.match(worker, /cpus: 1\.0/);
  assert.match(worker, /mem_limit: 768m/);
  assert.match(worker, /pids_limit: 256/);
  assert.match(worker, /projectai-staging-internal/);
  assert.match(worker, /projectai-document-worker-heartbeat/);
  assert.match(worker, /OBJECT_STORAGE_ACCESS_KEY/);
  assert.match(worker, /OBJECT_STORAGE_SECRET_KEY/);
  assert.doesNotMatch(worker, /MINIO_ROOT_(?:USER|PASSWORD)/);
  assert.doesNotMatch(worker, /^\s+ports:/m);
  assert.match(script, /Starting the independent Staging document Worker/);
  assert.match(script, /projectai-document-worker[\s\S]+?projectai-staging/);
  assert.match(script, /pg_extension where extname = \$1/);
  assert.match(script, /npm run documents:enqueue/);
  assert.match(dockerfile, /COPY --from=deps --chown=node:node \/app\/node_modules/);
  assert.match(dockerfile, /COPY --chown=node:node lib \.\/lib/);
  assert.match(
    dockerfile,
    /COPY --chown=node:node tests\/fixtures\/hybrid-retrieval-evaluation\.json \.\/tests\/fixtures\/hybrid-retrieval-evaluation\.json/,
  );
  assert.match(dockerfile, /RUN install -d -o node -g node \/app\/review-artifacts/);
  assert.match(dockerfile, /USER node/);
});

test("Staging deploy runs the complete Phase 1 HTTP verification in a scoped operations service", async () => {
  const [script, compose, verifier] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
    readFile(new URL("../scripts/verify-phase1-staging.mjs", import.meta.url), "utf8"),
  ]);
  const service = serviceBlock(compose, "projectai-phase1-smoke", "projectai-staging");
  assert.match(service, /profiles:\n\s+- operations/);
  assert.match(service, /DATABASE_URL/);
  assert.match(service, /OBJECT_STORAGE_ACCESS_KEY/);
  assert.match(service, /SEED_DEPT_ADMIN_EMAIL/);
  assert.doesNotMatch(service, /QWEN_API_KEY|qwen_api_key|secrets:/);
  assert.match(script, /projectai-phase1-smoke npm run phase1:staging-smoke/);
  assert.match(verifier, /KNOWLEDGE_SPACE_NOT_FOUND/);
  assert.match(verifier, /not_mentioned/);
  assert.match(verifier, /weekly_report_published/);
  assert.match(verifier, /delete from projects where id = \$1/);
  assert.doesNotMatch(verifier, /projectai\/api|\/srv\/projectai(?:\/|\b)/);
});

test("Staging Qwen Secret is limited to the App and dedicated Embedding Worker", async () => {
  const [script, compose, production] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
    readFile(productionCompose, "utf8"),
  ]);
  const app = serviceBlock(
    compose,
    "projectai-staging",
    "projectai-document-worker",
  );
  const worker = serviceBlock(
    compose,
    "projectai-document-worker",
    "projectai-embedding-worker",
  );
  const embeddingWorker = compose.match(
    /\n  projectai-embedding-worker:\n([\s\S]*?)\nvolumes:/,
  )?.[1];
  assert.ok(embeddingWorker);
  assert.match(app, /env_file:\n\s+- \/srv\/projectai-staging\/\.env\.ai/);
  assert.match(app, /secrets:\n\s+- qwen_api_key/);
  assert.match(
    compose,
    /secrets:\n\s+qwen_api_key:\n\s+file: \/srv\/projectai-staging\/secrets\/qwen_api_key/,
  );
  assert.doesNotMatch(worker, /QWEN_|qwen_api_key|secrets:/);
  assert.match(embeddingWorker, /env_file:\n\s+- \/srv\/projectai-staging\/\.env\.ai/);
  assert.match(embeddingWorker, /secrets:\n\s+- qwen_api_key/);
  assert.match(embeddingWorker, /npm[\s\S]+worker:embeddings/);
  assert.doesNotMatch(embeddingWorker, /OBJECT_STORAGE_|MINIO_ROOT_/);
  assert.doesNotMatch(embeddingWorker, /^\s+ports:/m);
  assert.match(script, /sudo test -s "\$qwen_secret_file"/);
  assert.match(script, /stat -c '%a' "\$qwen_secret_file"/);
  assert.match(script, /stat -c '%U:%G' "\$qwen_secret_file"/);
  assert.match(script, /stat -c '%u:%g' "\$qwen_secret_file"/);
  assert.match(script, /id -u deploy/);
  assert.match(script, /id -g deploy/);
  assert.doesNotMatch(script, /cat [^\n]*qwen_api_key/);
  assert.match(
    script,
    /\.env\.ai\.preflight\.XXXXXX[\s\S]+?print "AI_ASSISTANT_ENABLED=false"[\s\S]+?install -m 0600 -o deploy -g deploy "\$ai_env_temp" "\$ai_env_file"/,
  );
  const probeIndex = script.indexOf("npm run ai:probe:qwen");
  const embeddingProbeIndex = script.indexOf("npm run embeddings:probe");
  const disableIndex = script.indexOf('print "AI_ASSISTANT_ENABLED=false"');
  const enableIndex = script.indexOf('print "AI_ASSISTANT_ENABLED=true"');
  const smokeIndex = script.indexOf("projectai-ai-smoke npm run assistant:smoke");
  const loginWindowIndex = script.indexOf(
    "Waiting for one protected login rate-limit window before Lease verification.",
  );
  const embeddingLoginWindowIndex = script.indexOf(
    "Waiting for one protected login rate-limit window before Embedding verification.",
  );
  const regressionLoginWindowIndex = script.indexOf(
    "Waiting for one protected login rate-limit window before the post-Embedding B3-A regression.",
  );
  const leaseIndex = script.indexOf("npm run documents:lease-smoke");
  assert.ok(
    disableIndex >= 0 &&
      probeIndex > disableIndex &&
      embeddingProbeIndex > probeIndex &&
      enableIndex > embeddingProbeIndex &&
      smokeIndex > enableIndex,
  );
  assert.ok(
    embeddingLoginWindowIndex > smokeIndex &&
      regressionLoginWindowIndex > embeddingLoginWindowIndex &&
      loginWindowIndex > regressionLoginWindowIndex &&
      leaseIndex > loginWindowIndex,
    "Authentication-heavy smoke phases must be separated by protected login rate-limit windows",
  );
  assert.equal(
    [...script.matchAll(/for _ in \$\(seq 1 13\); do\n\s+sleep 5\ndone/g)].length,
    5,
  );
  assert.match(
    script,
    /up --detach --no-deps --force-recreate --no-build --pull never projectai-staging/,
  );
  assert.match(script, /"aiAssistantEnabled":false/);
  assert.match(script, /"aiAssistantEnabled":true/);
  assert.match(script, /"aiEmbeddingEnabled":false/);
  assert.match(script, /"aiEmbeddingEnabled":true/);
  assert.match(script, /stale_after \+= 0/);
  assert.match(script, /stale_after < 300000 \|\| stale_after > 3600000/);
  assert.match(script, /running AI, Embedding, or Retrieval operation/);
  assert.match(script, /Staging application logs contain prohibited AI request or Secret markers/);
  assert.doesNotMatch(production, /qwen_api_key|QWEN_API_KEY|QWEN_BASE_URL|secrets:/);
});

test("B3-B1 deployment pins pgvector and gates the dedicated Embedding pipeline", async () => {
  const [script, compose, workflow, production] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
    readFile(ciWorkflow, "utf8"),
    readFile(productionCompose, "utf8"),
  ]);
  assert.match(compose, /pgvector\/pgvector:0\.8\.1-pg17/);
  assert.match(workflow, /pgvector\/pgvector:0\.8\.1-pg17/);
  assert.match(workflow, /npm run embeddings:migration-upgrade/);
  assert.match(script, /POSTGRES_IMAGE_REF="pgvector\/pgvector:0\.8\.1-pg17@sha256:[0-9a-f]{64}"/);
  assert.match(script, /Recreating Staging PostgreSQL with the pinned PostgreSQL 17 pgvector image after backups completed/);
  assert.match(script, /vector_type !== "vector\(1024\)"/);
  assert.match(script, /array_agg\(e\.enumlabel::text order by e\.enumsortorder\)/);
  assert.match(script, /where table_schema = \$14 and table_name = \$10/);
  assert.match(script, /where schemaname = \$14 and tablename = \$10/);
  assert.match(script, /and indexdef like \$15/);
  assert.match(script, /document_embedding_provider_calls/);
  assert.match(script, /document_embedding_provider_call_status/);
  assert.match(script, /document_embedding_provider_calls_terminal_immutable/);
  assert.doesNotMatch(script, /table_schema = 'public'|schemaname = 'public'/);
  assert.match(script, /qwen-text-embedding-cn-v1/);
  assert.match(script, /text-embedding-v4/);
  assert.match(script, /AI_EMBEDDING_ENABLED=false/);
  assert.match(script, /new Staging code with AI_EMBEDDING_ENABLED=false before Migration/);
  assert.match(script, /"pgvectorReady":false/);
  assert.match(script, /print "AI_EMBEDDING_ENABLED=true"/);
  assert.match(script, /npm run embeddings:probe/);
  assert.match(script, /npm run embeddings:smoke:prepare/);
  assert.match(script, /npm run embeddings:lease-smoke/);
  assert.match(script, /npm run embeddings:smoke:verify/);
  assert.match(script, /embeddings:safety-smoke -- --crash-window/);
  assert.match(script, /embeddings:safety-smoke -- --shutdown/);
  assert.match(script, /embeddings:safety-smoke -- --budget/);
  assert.match(script, /embeddings:safety-smoke -- --cost-consistency/);
  assert.match(
    script,
    /document_embedding_batches where status::text in \(\$4, \$5, \$6\)/,
  );
  assert.match(
    script,
    /document_embedding_provider_calls where status::text in \(\$4, \$5, \$6\)/,
  );
  assert.match(
    script,
    /document_embedding_batches where status::text in \(\$7, \$8, \$9\)/,
  );
  assert.match(
    script,
    /document_embedding_provider_calls where status::text in \(\$7, \$8, \$9\)/,
  );
  assert.match(compose, /projectai-embedding-worker:[\s\S]+?stop_grace_period: 45s/);
  assert.match(compose, /AI_EMBEDDING_WORKER_SHUTDOWN_DRAIN_MS:[^\n]+25000/);
  assert.match(script, /Re-running B3-A grounded Qwen regression while Embedding remains enabled and lexical retrieval remains unchanged/);
  assert.doesNotMatch(production, /pgvector|AI_EMBEDDING|embedding-worker|document_chunk_embeddings/i);
});

test("B3-B2 deployment enforces lexical, shadow, then quality-gated hybrid App promotion", async () => {
  const [script, workflow, production, groundedVerifier] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(ciWorkflow, "utf8"),
    readFile(productionCompose, "utf8"),
    readFile(groundedAiVerifier, "utf8"),
  ]);
  assert.match(script, /DEFAULT_EXPECTED_BRANCH="agent\/phase1-project-knowledge-management"/);
  assert.match(
    script,
    /EXPECTED_BRANCH="\$\{PROJECTAI_STAGING_DEPLOY_BRANCH:-\$DEFAULT_EXPECTED_BRANCH\}"/,
  );
  const lexical = script.indexOf('print "AI_ASSISTANT_RETRIEVAL_MODE=lexical"');
  const evaluation = script.indexOf("npm run retrieval:evaluate");
  const shadow = script.indexOf('print "AI_ASSISTANT_RETRIEVAL_MODE=shadow"');
  const shadowReport = script.indexOf("npm run retrieval:shadow-report");
  const hybrid = script.indexOf('print "AI_ASSISTANT_RETRIEVAL_MODE=hybrid"');
  assert.ok(
    lexical >= 0 && evaluation > lexical && shadow > evaluation &&
      shadowReport > shadow && hybrid > shadowReport,
  );
  assert.match(script, /"assistantRetrievalMode":"shadow"/);
  assert.match(script, /"assistantRetrievalMode":"hybrid"/);
  assert.match(script, /"hybridRetrievalReady":true/);
  assert.match(script, /retrieval_evaluation_digest/);
  assert.match(script, /npm run retrieval:probe/);
  assert.match(script, /npm run retrieval:status/);
  assert.match(script, /project_scope_leakage_count/);
  assert.match(groundedVerifier, /vector_latency_ms <= 1_500/);
  assert.match(groundedVerifier, /total_latency_ms <= 8_000/);
  assert.match(groundedVerifier, /vectorSqlP95Ms <= 1_500/);
  assert.match(groundedVerifier, /retrievalP95Ms <= 8_000/);
  assert.match(workflow, /npm run retrieval:migration-upgrade/);
  assert.match(workflow, /npm run test:retrieval-integration/);
  assert.match(workflow, /npm run retrieval:evaluate/);
  assert.doesNotMatch(production, /AI_ASSISTANT_RETRIEVAL_MODE|hybrid-rrf|ai_retrieval/i);
});

test("Staging banner states the B3-B2 retrieval boundary accurately", async () => {
  const banner = await readFile(environmentBanner, "utf8");
  assert.match(banner, /v0\.8 评测驱动的 Hybrid Retrieval/);
  assert.match(banner, /Query Embedding、精确向量检索与 RRF/);
  assert.match(banner, /知识搜索仍为词法检索/);
  assert.match(banner, /ANN 与 Rerank 尚未启用/);
  assert.doesNotMatch(banner, /AI 综合回答尚未启用/);
});

test("Staging proxy accepts multipart framing without exposing object storage", async () => {
  const nginx = await readFile(stagingNginx, "utf8");
  const assetsLocation = nginx.indexOf("location ^~ /tool/projectai-staging/assets/ {");
  const appLocation = nginx.indexOf("location ^~ /tool/projectai-staging/ {");
  assert.ok(assetsLocation >= 0 && appLocation > assetsLocation);
  assert.match(nginx, /client_max_body_size 52m;/);
  assert.doesNotMatch(nginx, /9000|9001|minio/i);

  const script = await readFile(deployScript, "utf8");
  assert.match(
    script,
    /trimmed == "location \^~ " path "\/ \{"/,
  );
});

test("Staging verification preserves the environment name inside secure cookie prefixes", () => {
  assert.equal(
    normalizeApplicationCookieName(
      "__Secure-projectai_staging.session_token=opaque; Path=/tool/projectai-staging",
    ),
    "projectai_staging.session_token",
  );
  assert.equal(
    normalizeApplicationCookieName(
      "projectai_local.session_token=opaque; Path=/tool/projectai",
    ),
    "projectai_local.session_token",
  );
});

test("public Staging redirects stay on the canonical HTTPS URL", async () => {
  const [script, compose, nginx, proxy] = await Promise.all([
    readFile(deployScript, "utf8"),
    readFile(stagingCompose, "utf8"),
    readFile(stagingNginx, "utf8"),
    readFile(requestProxy, "utf8"),
  ]);
  assert.match(compose, /VINEXT_TRUSTED_HOSTS: gridworks\.cn/);
  assert.match(nginx, /return 308 https:\/\/gridworks\.cn\/tool\/projectai-staging\//);
  assert.match(proxy, /host !== expectedHost/);
  assert.match(proxy, /forwardedHost !== expectedHost/);
  assert.match(proxy, /forwardedProto !== "https"/);
  assert.match(proxy, /status: 404/);
  assert.match(script, /--header 'Host: attacker\.invalid'/);
  assert.match(script, /hostile_app_code" == "404"/);
  assert.match(
    script,
    /app_root_ready=0[\s\S]+?for _ in \$\(seq 1 15\)[\s\S]+?app_root_ready=1/,
  );
  assert.match(
    script,
    /app_root_location" == "\$\{PUBLIC_STAGING_URL\}\/dashboard"/,
  );
});

test("authentication boundary verification revokes sessions on failure paths", async () => {
  const verifier = await readFile(authBoundaryVerifier, "utf8");
  assert.match(verifier, /projectai-staging-boundary-verifier/);
  assert.match(verifier, /randomUUID\(\)/);
  assert.match(verifier, /async function withSession/);
  assert.match(verifier, /delete from sessions where user_agent = \$1/);
  assert.match(verifier, /leakedSessionCount > 0/);
  assert.doesNotMatch(verifier, /signOut\([^\n]+\.catch/);
});

test("internal file smoke preserves the reviewed public proxy origin", async () => {
  const verifier = await readFile(fileStorageVerifier, "utf8");
  assert.match(verifier, /fetchWithPublicHost\(endpoint\(path\), configuredRequestOrigin, init\)/);
  assert.doesNotMatch(verifier, /x-forwarded-host/i);
  assert.doesNotMatch(verifier, /x-forwarded-proto/i);
});

test("Staging deployment shell is syntactically valid", async () => {
  await execFileAsync("bash", ["-n", deployScript.pathname]);
  const script = await readFile(deployScript, "utf8");
  const remoteDeploy = script.match(
    /<<'REMOTE_DEPLOY'\n([\s\S]+?)\nREMOTE_DEPLOY/,
  )?.[1];
  assert.ok(remoteDeploy);
  await execFileAsync("bash", ["-n", "-c", remoteDeploy]);
  const inlineModules = [
    ...script.matchAll(/node --input-type=module -e '\n([\s\S]*?)\n  '/g),
  ];
  assert.ok(inlineModules.length > 0);
  for (const inlineModule of inlineModules) {
    assert.doesNotMatch(
      inlineModule[1],
      /'/,
      "single-quoted Node -e payloads must not contain raw apostrophes",
    );
  }
});
