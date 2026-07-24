#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_BRANCH="agent/projectai-product-architecture-v2"
readonly REMOTE_HOST="${REMOTE_HOST:-gridworks.cn}"
readonly REMOTE_DIR="/srv/projectai-staging"
readonly COMPOSE_PROJECT="projectai-staging"
readonly COMPOSE_FILE="docker-compose.staging.yml"
readonly BASE_PATH="/tool/projectai-staging"
readonly PUBLIC_URL="https://gridworks.cn/tool/projectai-staging"
readonly ENV_FILE="${REMOTE_DIR}/.env.auth-staging"
readonly AI_ENV_FILE="${REMOTE_DIR}/.env.ai"
readonly EMBEDDING_ENV_FILE="${REMOTE_DIR}/.env.embedding"
readonly QWEN_SECRET_FILE="${REMOTE_DIR}/secrets/qwen_api_key"
readonly LOCK_DIR="${REMOTE_DIR}/.staging-deploy-lock"
readonly MARKER="${REMOTE_DIR}/.product-v2-deploy-in-progress"
readonly POSTGRES_IMAGE_REF="pgvector/pgvector:0.8.1-pg17@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21"
readonly MINIO_IMAGE_REF="quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z"
readonly MINIO_CLIENT_IMAGE_REF="quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z"

log() { printf '[projectai-product-v2-staging] %s\n' "$*"; }
fail() { printf '[projectai-product-v2-staging] ERROR: %s\n' "$*" >&2; exit 1; }
require_command() { command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"; }

for command_name in git ssh rsync docker gzip tar mktemp curl node; do
  require_command "$command_name"
done

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run from a Git checkout"
cd "$ROOT_DIR"
[[ "$(git branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "Expected branch ${EXPECTED_BRANCH}"
[[ -z "$(git status --porcelain --untracked-files=all | grep -Ev '^\?\? pocket-charista(/|\.zip$)' || true)" ]] \
  || fail "Refusing to deploy tracked or ProjectAI untracked changes"
git diff --check --cached

COMMIT_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/${EXPECTED_BRANCH}")"
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ && "$COMMIT_SHA" == "$REMOTE_SHA" ]] \
  || fail "Deployment Head must exactly match origin/${EXPECTED_BRANCH}"
APP_VERSION="$(node -p 'require("./package.json").version')"
BUILD_TIME="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
DEPLOY_ID="${COMMIT_SHA}-$(date -u +'%Y%m%dT%H%M%SZ')-$$-${RANDOM}"
APP_IMAGE_REF="project-ai-os-staging:${COMMIT_SHA}"
DB_TOOLS_IMAGE_REF="project-ai-os-staging-db-tools:${COMMIT_SHA}"
RELEASE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/projectai-product-v2-release.XXXXXX")"
LOCK_ACQUIRED=0

SSH=(
  ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12
  -o ConnectTimeout=10 "$REMOTE_HOST"
)

release_lock() {
  [[ "$LOCK_ACQUIRED" == "1" ]] || return 0
  "${SSH[@]}" bash -s -- "$LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_UNLOCK'
set -Eeuo pipefail
lock_dir="$1"
deploy_id="$2"
[[ "$lock_dir" == "/srv/projectai-staging/.staging-deploy-lock" ]]
[[ "$(sudo cat "$lock_dir/deploy-id")" == "$deploy_id" ]]
sudo rm -f -- "$lock_dir/deploy-id"
sudo rmdir -- "$lock_dir"
REMOTE_UNLOCK
  LOCK_ACQUIRED=0
}

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  release_lock || status=1
  rm -rf -- "$RELEASE_ROOT"
  exit "$status"
}
trap cleanup EXIT

log "Acquiring the isolated Staging lock"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$LOCK_DIR" "$DEPLOY_ID" "$MARKER" <<'REMOTE_LOCK'
set -Eeuo pipefail
remote_dir="$1"
lock_dir="$2"
deploy_id="$3"
marker="$4"
[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$lock_dir" == "$remote_dir/.staging-deploy-lock" ]]
[[ "$marker" == "$remote_dir/.product-v2-deploy-in-progress" ]]
sudo -n true
sudo test -d "$remote_dir"
sudo test ! -L "$remote_dir"
[[ "$(sudo readlink -f -- "$remote_dir")" == "$remote_dir" ]]
sudo test ! -e "$marker" || { printf 'Product V2 deployment marker requires review.\n' >&2; exit 1; }
if ! sudo mkdir -m 0700 "$lock_dir"; then
  printf 'Another Staging deployment lock requires review.\n' >&2
  exit 1
fi
printf '%s\n' "$deploy_id" | sudo tee "$lock_dir/deploy-id" >/dev/null
sudo chmod 600 "$lock_dir/deploy-id"
REMOTE_LOCK
LOCK_ACQUIRED=1

log "Checking Staging-only prerequisites without reading credential values"
REMOTE_ARCH="$("${SSH[@]}" bash -s -- "$ENV_FILE" "$AI_ENV_FILE" "$EMBEDDING_ENV_FILE" "$QWEN_SECRET_FILE" "$LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_PREFLIGHT'
set -Eeuo pipefail
env_file="$1"
ai_env_file="$2"
embedding_env_file="$3"
qwen_secret_file="$4"
lock_dir="$5"
deploy_id="$6"
command -v docker >/dev/null
command -v curl >/dev/null
command -v rsync >/dev/null
sudo docker compose version >/dev/null
[[ "$(sudo cat "$lock_dir/deploy-id")" == "$deploy_id" ]]
for protected in "$env_file" "$ai_env_file" "$embedding_env_file" "$qwen_secret_file"; do
  sudo test -f "$protected"
  sudo test ! -L "$protected"
  sudo test -s "$protected"
  [[ "$(sudo stat -c '%a' "$protected")" == "600" ]]
done
for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL BETTER_AUTH_SECRET BETTER_AUTH_URL AUTH_COOKIE_PREFIX AUTH_TRUSTED_ORIGINS OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY; do
  count="$(sudo awk -F= -v key="$key" '$1 == key && length(substr($0,index($0,"=")+1)) > 0 { count += 1 } END { print count + 0 }' "$env_file")"
  [[ "$count" == "1" ]] || { printf 'Protected Staging environment is incomplete.\n' >&2; exit 1; }
done
sudo awk -F= '
  $1 == "BETTER_AUTH_URL" { ok += substr($0,index($0,"=")+1) == "https://gridworks.cn/tool/projectai-staging/api/auth" }
  $1 == "AUTH_COOKIE_PREFIX" { ok += substr($0,index($0,"=")+1) == "projectai_staging" }
  $1 == "AUTH_TRUSTED_ORIGINS" { ok += substr($0,index($0,"=")+1) == "https://gridworks.cn" }
  $1 == "OBJECT_STORAGE_ENDPOINT" { ok += substr($0,index($0,"=")+1) == "http://projectai-minio:9000" }
  END { exit(ok == 4 ? 0 : 1) }
' "$env_file" || { printf 'Staging boundary configuration is invalid.\n' >&2; exit 1; }
arch="$(sudo docker info --format '{{.Architecture}}')"
[[ "$arch" == "amd64" || "$arch" == "arm64" ]]
printf '%s' "$arch"
REMOTE_PREFLIGHT
)"
REMOTE_PLATFORM="linux/${REMOTE_ARCH}"

log "Creating the tracked release and building immutable ${REMOTE_PLATFORM} images"
git archive --format=tar "$COMMIT_SHA" | tar -xf - -C "$RELEASE_ROOT"
[[ ! -e "$RELEASE_ROOT/.env.auth-staging" && -f "$RELEASE_ROOT/$COMPOSE_FILE" ]]
[[ -z "$(git ls-tree -r --name-only "$COMMIT_SHA" | awk '/(^|\/)\.env($|\.)/ && $0 !~ /\.example$/ { print } /\.(pem|key|p12|pfx)$/ { print }')" ]] \
  || fail "Tracked release contains a prohibited secret-like path"

docker build --pull --platform "$REMOTE_PLATFORM" --target runner \
  --build-arg "NEXT_PUBLIC_BASE_PATH=$BASE_PATH" \
  --build-arg "NEXT_PUBLIC_APP_ENV=staging" \
  --build-arg "NEXT_PUBLIC_APP_VERSION=$APP_VERSION" \
  --build-arg "NEXT_PUBLIC_COMMIT_SHA=$COMMIT_SHA" \
  --build-arg "NEXT_PUBLIC_BUILD_TIME=$BUILD_TIME" \
  --tag "$APP_IMAGE_REF" "$RELEASE_ROOT"
docker build --pull --platform "$REMOTE_PLATFORM" --target db-tools \
  --tag "$DB_TOOLS_IMAGE_REF" "$RELEASE_ROOT"
APP_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$APP_IMAGE_REF")"
DB_TOOLS_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$DB_TOOLS_IMAGE_REF")"
[[ "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ && "$DB_TOOLS_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]

log "Backing up the Staging database and protected configuration before any release sync"
"${SSH[@]}" bash -s -- \
  "$REMOTE_DIR" "$ENV_FILE" "$AI_ENV_FILE" "$EMBEDDING_ENV_FILE" \
  "$LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_BACKUP'
set -Eeuo pipefail
remote_dir="$1"; env_file="$2"; ai_env_file="$3"; embedding_env_file="$4"
lock_dir="$5"; deploy_id="$6"
[[ "$remote_dir" == "/srv/projectai-staging" && "$(sudo cat "$lock_dir/deploy-id")" == "$deploy_id" ]]
sudo install -d -m 0700 -o root -g root "$remote_dir/backups"
backup_path="$remote_dir/backups/projectai-product-v2-${deploy_id}.dump"
env_backup="$remote_dir/backups/product-v2-auth-env-${deploy_id}.bak"
ai_env_backup="$remote_dir/backups/product-v2-ai-env-${deploy_id}.bak"
embedding_env_backup="$remote_dir/backups/product-v2-embedding-env-${deploy_id}.bak"
for target in "$backup_path" "$env_backup" "$ai_env_backup" "$embedding_env_backup"; do
  sudo test ! -e "$target"
done
sudo docker inspect project-ai-os-staging-postgres >/dev/null
sudo docker exec project-ai-os-staging-postgres sh -ec 'pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | sudo tee "$backup_path" >/dev/null
sudo chmod 600 "$backup_path"
sudo test -s "$backup_path"
sudo docker exec -i project-ai-os-staging-postgres pg_restore --list < "$backup_path" >/dev/null
sudo install -m 0600 -o root -g root "$env_file" "$env_backup"
sudo install -m 0600 -o root -g root "$ai_env_file" "$ai_env_backup"
sudo install -m 0600 -o root -g root "$embedding_env_file" "$embedding_env_backup"
REMOTE_BACKUP

log "Marking and syncing the tracked Staging release"
"${SSH[@]}" bash -s -- "$MARKER" "$LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_MARK'
set -Eeuo pipefail
marker="$1"
lock_dir="$2"
deploy_id="$3"
[[ "$(sudo cat "$lock_dir/deploy-id")" == "$deploy_id" ]]
sudo install -m 0600 -o root -g root /dev/null "$marker"
REMOTE_MARK

rsync --archive --compress --delete \
  --filter='protect /backups/***' \
  --filter='protect /.local/***' \
  --filter='protect /.env.auth-staging' \
  --filter='protect /.env.ai' \
  --filter='protect /.env.embedding' \
  --filter='protect /secrets/***' \
  --filter='protect /.product-v2-deploy-in-progress' \
  --filter='protect /.staging-deploy-in-progress' \
  --filter='protect /.staging-deploy-lock/***' \
  --exclude '/.git/' --exclude '/node_modules/' --exclude '/dist/' \
  --exclude '/.vinext/' --exclude '/.wrangler/' --exclude '/test-results/' \
  --exclude '/playwright-report/' --exclude '/.local/' --exclude '/.env*' \
  --exclude '/secrets/' --exclude '*.log' \
  --rsh='ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12 -o ConnectTimeout=10' \
  "$RELEASE_ROOT/" "${REMOTE_HOST}:${REMOTE_DIR}/"

log "Transferring the reviewed images"
docker save "$APP_IMAGE_REF" "$DB_TOOLS_IMAGE_REF" | gzip -1 | "${SSH[@]}" 'sudo docker load >/dev/null'

log "Backing up, migrating, seeding, and starting Product V2 on Staging"
"${SSH[@]}" bash -s -- \
  "$REMOTE_DIR" "$ENV_FILE" "$AI_ENV_FILE" "$EMBEDDING_ENV_FILE" "$QWEN_SECRET_FILE" \
  "$COMPOSE_PROJECT" "$COMPOSE_FILE" "$MARKER" "$LOCK_DIR" "$DEPLOY_ID" \
  "$COMMIT_SHA" "$APP_VERSION" "$BUILD_TIME" "$APP_IMAGE_REF" "$APP_IMAGE_ID" \
  "$DB_TOOLS_IMAGE_REF" "$DB_TOOLS_IMAGE_ID" "$POSTGRES_IMAGE_REF" \
  "$MINIO_IMAGE_REF" "$MINIO_CLIENT_IMAGE_REF" <<'REMOTE_DEPLOY'
set -Eeuo pipefail
remote_dir="$1"; env_file="$2"; ai_env_file="$3"; embedding_env_file="$4"; qwen_secret_file="$5"
compose_project="$6"; compose_file="$7"; marker="$8"; lock_dir="$9"; deploy_id="${10}"
commit_sha="${11}"; app_version="${12}"; build_time="${13}"; app_image_ref="${14}"; app_image_id="${15}"
db_tools_ref="${16}"; db_tools_id="${17}"; postgres_ref="${18}"; minio_ref="${19}"; minio_client_ref="${20}"
cd "$remote_dir"
[[ "$remote_dir" == "/srv/projectai-staging" && "$(sudo cat "$lock_dir/deploy-id")" == "$deploy_id" ]]
[[ "$(sudo docker image inspect --format '{{.Id}}' "$app_image_ref")" == "$app_image_id" ]]
[[ "$(sudo docker image inspect --format '{{.Id}}' "$db_tools_ref")" == "$db_tools_id" ]]

previous_app_ref="$(sudo docker inspect --format '{{.Config.Image}}' project-ai-os-staging 2>/dev/null || true)"
previous_worker_ref="$(sudo docker inspect --format '{{.Config.Image}}' project-ai-os-staging-worker 2>/dev/null || true)"
previous_embedding_ref="$(sudo docker inspect --format '{{.Config.Image}}' project-ai-os-staging-embedding-worker 2>/dev/null || true)"
backup_path="$remote_dir/backups/projectai-product-v2-${deploy_id}.dump"
env_backup="$remote_dir/backups/product-v2-auth-env-${deploy_id}.bak"
ai_env_backup="$remote_dir/backups/product-v2-ai-env-${deploy_id}.bak"
embedding_env_backup="$remote_dir/backups/product-v2-embedding-env-${deploy_id}.bak"
for backup in "$backup_path" "$env_backup" "$ai_env_backup" "$embedding_env_backup"; do
  sudo test -f "$backup"
  sudo test ! -L "$backup"
  sudo test -s "$backup"
  [[ "$(sudo stat -c '%a' "$backup")" == "600" ]]
done

compose_base=(
  sudo env "NEXT_PUBLIC_COMMIT_SHA=$commit_sha" "NEXT_PUBLIC_APP_VERSION=$app_version"
  "NEXT_PUBLIC_BUILD_TIME=$build_time" "STAGING_APP_IMAGE=$app_image_ref"
  "STAGING_WORKER_IMAGE=$app_image_ref" "STAGING_EMBEDDING_WORKER_IMAGE=$app_image_ref"
  "STAGING_DB_TOOLS_IMAGE=$db_tools_ref" "STAGING_POSTGRES_IMAGE=$postgres_ref"
  "STAGING_MINIO_IMAGE=$minio_ref" "STAGING_MINIO_CLIENT_IMAGE=$minio_client_ref"
  docker compose --env-file "$env_file" --env-file "$embedding_env_file"
  --project-name "$compose_project" --file "$compose_file" --profile operations
)

rollback() {
  local status=$?
  trap - ERR
  set +e
  printf 'Product V2 deployment failed; restoring the verified Staging database, environment, and prior images.\n' >&2
  "${compose_base[@]}" stop projectai-staging projectai-document-worker projectai-embedding-worker >/dev/null 2>&1
  sudo docker exec -i project-ai-os-staging-postgres sh -ec 'pg_restore --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$backup_path"
  sudo install -m 0600 -o root -g root "$env_backup" "$env_file"
  sudo install -m 0600 -o deploy -g deploy "$ai_env_backup" "$ai_env_file"
  sudo install -m 0600 -o root -g root "$embedding_env_backup" "$embedding_env_file"
  if [[ -n "$previous_app_ref" && -n "$previous_worker_ref" ]]; then
    sudo env "STAGING_APP_IMAGE=$previous_app_ref" "STAGING_WORKER_IMAGE=$previous_worker_ref" \
      "STAGING_EMBEDDING_WORKER_IMAGE=${previous_embedding_ref:-$previous_app_ref}" \
      "STAGING_DB_TOOLS_IMAGE=$db_tools_ref" "STAGING_POSTGRES_IMAGE=$postgres_ref" \
      "STAGING_MINIO_IMAGE=$minio_ref" "STAGING_MINIO_CLIENT_IMAGE=$minio_client_ref" \
      docker compose --env-file "$env_file" --env-file "$embedding_env_file" \
      --project-name "$compose_project" --file "$compose_file" up --detach --no-build --pull never \
      projectai-document-worker projectai-embedding-worker projectai-staging >/dev/null
  fi
  sudo rm -f -- "$marker"
  exit "$status"
}

sudo docker inspect project-ai-os-staging-minio >/dev/null
trap rollback ERR

env_temp="$(sudo mktemp "$remote_dir/.env.auth-staging.product-v2.XXXXXX")"
sudo awk -F= '
  BEGIN { auth=0; mock=0; rate=0; org=0; daily=0; sync=0 }
  $1 ~ /^SEED_.*_PASSWORD$/ || $1 == "PROJECTAI_SEED_ENVIRONMENT" { next }
  $1 == "AUTH_PROVIDER" { print "AUTH_PROVIDER=mock-wecom"; auth += 1; next }
  $1 == "ALLOW_MOCK_WECOM_AUTH" { print "ALLOW_MOCK_WECOM_AUTH=true"; mock += 1; next }
  $1 == "AUTH_MOCK_LOGIN_RATE_LIMIT_MAX" { print "AUTH_MOCK_LOGIN_RATE_LIMIT_MAX=60"; rate += 1; next }
  $1 == "ORGANIZATION_NAME" { print "ORGANIZATION_NAME=Kivisense"; org += 1; next }
  $1 == "PM_DAILY_REPORT_ENABLED" { print "PM_DAILY_REPORT_ENABLED=true"; daily += 1; next }
  $1 == "WECOM_TIMESHEET_SYNC_ENABLED" { print "WECOM_TIMESHEET_SYNC_ENABLED=false"; sync += 1; next }
  { print }
  END {
    if (!auth) print "AUTH_PROVIDER=mock-wecom"
    if (!mock) print "ALLOW_MOCK_WECOM_AUTH=true"
    if (!rate) print "AUTH_MOCK_LOGIN_RATE_LIMIT_MAX=60"
    if (!org) print "ORGANIZATION_NAME=Kivisense"
    if (!daily) print "PM_DAILY_REPORT_ENABLED=true"
    if (!sync) print "WECOM_TIMESHEET_SYNC_ENABLED=false"
  }
' "$env_file" | sudo tee "$env_temp" >/dev/null
sudo install -m 0600 -o root -g root "$env_temp" "$env_file"
sudo rm -f -- "$env_temp"

ai_temp="$(sudo mktemp "$remote_dir/.env.ai.product-v2.XXXXXX")"
sudo awk -F= '
  BEGIN { enabled=0; mode=0 }
  $1 == "AI_ASSISTANT_ENABLED" { print "AI_ASSISTANT_ENABLED=false"; enabled += 1; next }
  $1 == "AI_ASSISTANT_RETRIEVAL_MODE" { print "AI_ASSISTANT_RETRIEVAL_MODE=lexical"; mode += 1; next }
  { print }
  END { if (enabled != 1) exit 1; if (!mode) print "AI_ASSISTANT_RETRIEVAL_MODE=lexical" }
' "$ai_env_file" | sudo tee "$ai_temp" >/dev/null
sudo install -m 0600 -o deploy -g deploy "$ai_temp" "$ai_env_file"
sudo rm -f -- "$ai_temp"

embedding_temp="$(sudo mktemp "$remote_dir/.env.embedding.product-v2.XXXXXX")"
sudo awk -F= '
  $1 == "AI_EMBEDDING_ENABLED" { print "AI_EMBEDDING_ENABLED=false"; updated += 1; next }
  { print }
  END { if (updated != 1) exit 1 }
' "$embedding_env_file" | sudo tee "$embedding_temp" >/dev/null
sudo install -m 0600 -o root -g root "$embedding_temp" "$embedding_env_file"
sudo rm -f -- "$embedding_temp"

"${compose_base[@]}" run --rm --no-deps --pull never --interactive=false --no-TTY projectai-migrate npm run db:migrate
"${compose_base[@]}" run --rm --no-deps --pull never --interactive=false --no-TTY projectai-migrate npm run db:seed:product-v2
"${compose_base[@]}" up --detach --no-build --pull never projectai-document-worker projectai-embedding-worker projectai-staging

ready=0
for _ in $(seq 1 90); do
  if [[ "$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' project-ai-os-staging 2>/dev/null || true)" == "healthy" ]]; then
    body="$(curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:3101/tool/projectai-staging/api/health" || true)"
    if grep -q '"status":"ok"' <<<"$body" && grep -q '"aiAssistantEnabled":false' <<<"$body"; then ready=1; break; fi
  fi
  sleep 2
done
[[ "$ready" == "1" ]]

sudo docker exec project-ai-os-staging npm run ai:probe:qwen >/dev/null
ai_temp="$(sudo mktemp "$remote_dir/.env.ai.product-v2-enabled.XXXXXX")"
sudo awk -F= '
  $1 == "AI_ASSISTANT_ENABLED" { print "AI_ASSISTANT_ENABLED=true"; updated += 1; next }
  { print }
  END { if (updated != 1) exit 1 }
' "$ai_env_file" | sudo tee "$ai_temp" >/dev/null
sudo install -m 0600 -o deploy -g deploy "$ai_temp" "$ai_env_file"
sudo rm -f -- "$ai_temp"
"${compose_base[@]}" up --detach --no-deps --force-recreate --no-build --pull never projectai-staging

enabled=0
for _ in $(seq 1 90); do
  headers="$(curl --silent --show-error --max-time 5 --dump-header - --output /tmp/projectai-product-v2-health "http://127.0.0.1:3101/tool/projectai-staging/api/health" 2>/dev/null | tr -d '\r' || true)"
  if grep -qi "^x-projectai-commit-sha: ${commit_sha}$" <<<"$headers" \
    && grep -q '"status":"ok"' /tmp/projectai-product-v2-health \
    && grep -q '"aiAssistantEnabled":true' /tmp/projectai-product-v2-health \
    && grep -q '"aiProviderConfigured":true' /tmp/projectai-product-v2-health; then enabled=1; break; fi
  sleep 2
done
sudo rm -f /tmp/projectai-product-v2-health
[[ "$enabled" == "1" ]]

"${compose_base[@]}" run --rm --no-deps --pull never --interactive=false --no-TTY \
  --env "APP_BASE_URL=http://projectai-staging:3000/tool/projectai-staging" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  --env "EXPECTED_COOKIE_PATH=/tool/projectai-staging" \
  --env "EXPECTED_COOKIE_PREFIX=projectai_staging" --env "REQUIRE_SECURE_COOKIE=1" \
  projectai-product-v2-smoke npm run product-v2:staging-smoke

"${compose_base[@]}" run --rm --no-deps --pull never --interactive=false --no-TTY projectai-migrate node --input-type=module -e '
  import pg from "pg";
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(`select
      (select count(*)::int from users where product_role = '\''super_admin'\'' and status = '\''active'\'') as super_admins,
      (select count(*)::int from organizations where slug = '\''kivisense'\'' and is_active) as organizations,
      (select count(*)::int from accounts a join users u on u.id = a.user_id where a.provider_id = '\''credential'\'' and lower(u.email) like '\''%@test.projectai.local'\'') as retired_credentials,
      (select count(*)::int from departments where organization_id = '\''org-legacy-default'\'' and level > 4) as invalid_depth`);
    const row = result.rows[0];
    if (row.super_admins < 1 || row.organizations !== 1 || row.retired_credentials !== 0 || row.invalid_depth !== 0) throw new Error("Product V2 database invariant failed");
  } finally { await client.end(); }
'

[[ "$(sudo docker inspect --format '{{.Image}}' project-ai-os-staging)" == "$app_image_id" ]]
[[ "$(sudo docker inspect --format '{{.Image}}' project-ai-os-staging-worker)" == "$app_image_id" ]]
[[ -z "$(sudo docker port project-ai-os-staging-worker)" ]]
sudo rm -f -- "$marker"
trap - ERR
printf 'PRODUCT_V2_STAGING_DEPLOYED head=%s backup=%s\n' "$commit_sha" "$(basename "$backup_path")"
REMOTE_DEPLOY

log "Verifying the public Staging route and exact deployed Head"
headers="$(curl --fail --silent --show-error --max-time 20 --dump-header - --output /dev/null "${PUBLIC_URL}/api/health" | tr -d '\r')"
grep -qi "^x-projectai-commit-sha: ${COMMIT_SHA}$" <<<"$headers" || fail "Public Staging Head mismatch"
[[ "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "${PUBLIC_URL}/login")" == "200" ]] \
  || fail "Public Staging login is unavailable"
log "Product V2 Staging deployment completed for ${COMMIT_SHA}"
