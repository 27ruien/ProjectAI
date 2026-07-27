#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_EXPECTED_BRANCH="agent/projectai-workflows-knowledge-v3"
readonly EXPECTED_BRANCH="${PROJECTAI_STAGING_DEPLOY_BRANCH:-$DEFAULT_EXPECTED_BRANCH}"
readonly REMOTE_HOST="${REMOTE_HOST:-gridworks.cn}"
readonly REMOTE_DIR="/srv/projectai-staging"
readonly LOCK_DIR="${REMOTE_DIR}/.staging-deploy-lock"
readonly MARKER="${REMOTE_DIR}/.v3-staging-promotion-in-progress"
readonly PUBLIC_STAGING_URL="https://gridworks.cn/tool/projectai-staging"

fail() { printf '[projectai-v3-staging] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[projectai-v3-staging] %s\n' "$*"; }
for command_name in git ssh curl node; do command -v "$command_name" >/dev/null 2>&1 || fail "Missing ${command_name}"; done

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run from a Git checkout"
cd "$ROOT_DIR"
[[ "$(git branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "Expected branch ${EXPECTED_BRANCH}"
[[ "$EXPECTED_BRANCH" == agent/* || "$EXPECTED_BRANCH" == "main" ]] || fail "Unexpected deployment branch"
[[ -z "$(git status --porcelain --untracked-files=all | grep -Ev '^\?\? pocket-charista(/|\.zip$)' || true)" ]] \
  || fail "Refusing to promote a dirty ProjectAI checkout"

COMMIT_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "origin/${EXPECTED_BRANCH}")"
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ && "$COMMIT_SHA" == "$REMOTE_SHA" ]] || fail "Promotion Head must match origin/${EXPECTED_BRANCH}"
APP_VERSION="$(node -p 'require("./package.json").version')"
BUILD_TIME="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
PROMOTION_ID="${COMMIT_SHA}-$(date -u +'%Y%m%dT%H%M%SZ')-$$-${RANDOM}"

SSH=(ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=12 -o ConnectTimeout=10 "$REMOTE_HOST")
production_state() {
  "${SSH[@]}" "sudo docker inspect --format '{{.Id}} {{.Image}} {{.State.Running}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' project-ai-os"
}
PRODUCTION_BEFORE="$(production_state)" || fail "Production baseline unavailable"
read -r _ _ production_running _ production_health <<<"$PRODUCTION_BEFORE"
[[ "$production_running" == "true" && ( "$production_health" == "healthy" || "$production_health" == "none" ) ]] \
  || fail "Production baseline is not healthy"

PUBLIC_HEADERS="$(curl --fail --silent --show-error --max-time 20 --dump-header - --output /dev/null "${PUBLIC_STAGING_URL}/api/health" | tr -d '\r')"
grep -qi "^x-projectai-commit-sha: ${COMMIT_SHA}$" <<<"$PUBLIC_HEADERS" || fail "Staging is not running the exact promotion Head"

LOCK_ACQUIRED=0
release_lock() {
  [[ "$LOCK_ACQUIRED" == "1" ]] || return 0
  "${SSH[@]}" bash -s -- "$LOCK_DIR" "$PROMOTION_ID" <<'REMOTE_UNLOCK'
set -Eeuo pipefail
lock_dir="$1"; promotion_id="$2"
[[ "$lock_dir" == "/srv/projectai-staging/.staging-deploy-lock" ]]
[[ "$(sudo cat "$lock_dir/deploy-id")" == "$promotion_id" ]]
sudo unlink "$lock_dir/deploy-id"
sudo rmdir "$lock_dir"
REMOTE_UNLOCK
  LOCK_ACQUIRED=0
}
finish() {
  status=$?
  trap - EXIT
  set +e
  release_lock || status=1
  production_after="$(production_state 2>/dev/null)"
  [[ -n "$production_after" && "$production_after" == "$PRODUCTION_BEFORE" ]] || status=1
  exit "$status"
}
trap finish EXIT

log "Acquiring the isolated Staging promotion lock"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$LOCK_DIR" "$MARKER" "$PROMOTION_ID" <<'REMOTE_LOCK'
set -Eeuo pipefail
remote_dir="$1"; lock_dir="$2"; marker="$3"; promotion_id="$4"
[[ "$remote_dir" == "/srv/projectai-staging" && "$lock_dir" == "$remote_dir/.staging-deploy-lock" ]]
[[ "$marker" == "$remote_dir/.v3-staging-promotion-in-progress" ]]
sudo -n true
sudo test ! -e "$marker"
if ! sudo mkdir -m 0700 "$lock_dir"; then echo "Staging deployment lock requires review" >&2; exit 1; fi
printf '%s\n' "$promotion_id" | sudo tee "$lock_dir/deploy-id" >/dev/null
sudo chmod 600 "$lock_dir/deploy-id"
REMOTE_LOCK
LOCK_ACQUIRED=1

log "Running guarded Qwen, Embedding, and Hybrid promotion gates"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$LOCK_DIR" "$MARKER" "$PROMOTION_ID" "$COMMIT_SHA" "$APP_VERSION" "$BUILD_TIME" <<'REMOTE_PROMOTE'
set -Eeuo pipefail
remote_dir="$1"; lock_dir="$2"; marker="$3"; promotion_id="$4"; commit_sha="$5"; app_version="$6"; build_time="$7"
env_file="$remote_dir/.env.auth-staging"
ai_env_file="$remote_dir/.env.ai"
embedding_env_file="$remote_dir/.env.embedding"
compose_file="$remote_dir/docker-compose.staging.yml"
ai_backup="$remote_dir/.env.ai.v3-promotion-backup"
embedding_backup="$remote_dir/.env.embedding.v3-promotion-backup"
app_image_ref="project-ai-os-staging:${commit_sha}"
db_tools_image_ref="project-ai-os-staging-db-tools:${commit_sha}"
postgres_image_ref="pgvector/pgvector:0.8.1-pg17@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21"
minio_image_ref="quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z"
minio_client_image_ref="quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z"
origin="http://127.0.0.1:3101/tool/projectai-staging"
backed_up=0

[[ "$remote_dir" == "/srv/projectai-staging" && "$(sudo cat "$lock_dir/deploy-id")" == "$promotion_id" ]]
[[ "$marker" == "$remote_dir/.v3-staging-promotion-in-progress" ]]
cd "$remote_dir"
for file in "$env_file" "$ai_env_file" "$embedding_env_file" "$compose_file"; do sudo test -f "$file"; sudo test ! -L "$file"; done
for secret in "$remote_dir/secrets/qwen_api_key" "$remote_dir/secrets/audio_download_signing_key"; do
  sudo test -f "$secret"; sudo test ! -L "$secret"; sudo test -s "$secret"
  [[ "$(sudo stat -c '%a|%u:%g' "$secret")" == "600|1000:1000" ]]
done
sudo test ! -e "$ai_backup"; sudo test ! -e "$embedding_backup"
sudo install -m 0600 -o deploy -g deploy "$ai_env_file" "$ai_backup"
sudo install -m 0600 -o root -g root "$embedding_env_file" "$embedding_backup"
printf '%s\n' "$commit_sha" | sudo tee "$marker" >/dev/null
sudo chmod 600 "$marker"
backed_up=1

compose=(
  sudo env
  "NEXT_PUBLIC_COMMIT_SHA=$commit_sha" "NEXT_PUBLIC_APP_VERSION=$app_version" "NEXT_PUBLIC_BUILD_TIME=$build_time"
  "STAGING_APP_IMAGE=$app_image_ref" "STAGING_WORKER_IMAGE=$app_image_ref"
  "STAGING_EMBEDDING_WORKER_IMAGE=$app_image_ref" "STAGING_TIMESHEET_WORKER_IMAGE=$app_image_ref"
  "STAGING_WORKFLOW_WORKER_IMAGE=$app_image_ref" "STAGING_DB_TOOLS_IMAGE=$db_tools_image_ref"
  "STAGING_POSTGRES_IMAGE=$postgres_image_ref" "STAGING_MINIO_IMAGE=$minio_image_ref"
  "STAGING_MINIO_CLIENT_IMAGE=$minio_client_image_ref"
  docker compose --env-file "$env_file" --env-file "$embedding_env_file"
  --project-name projectai-staging --file "$compose_file" --profile operations
)
compose_run=("${compose[@]}" run --rm --no-deps --pull never --interactive=false --no-TTY)

restore() {
  status=$?
  trap - ERR EXIT
  set +e
  if [[ "$backed_up" == "1" ]]; then
    sudo install -m 0600 -o deploy -g deploy "$ai_backup" "$ai_env_file"
    sudo install -m 0600 -o root -g root "$embedding_backup" "$embedding_env_file"
    "${compose[@]}" up --detach --no-deps --force-recreate --no-build --pull never \
      projectai-document-worker projectai-embedding-worker projectai-staging >/dev/null 2>&1
    sudo unlink "$ai_backup" 2>/dev/null || true
    sudo unlink "$embedding_backup" 2>/dev/null || true
  fi
  sudo unlink "$marker" 2>/dev/null || true
  exit "$status"
}
trap restore ERR EXIT

sudo awk -F= '
  $1 == "AI_ASSISTANT_ENABLED" { a += 1; av = $2 }
  $1 == "AI_ASSISTANT_RETRIEVAL_MODE" { m += 1; mv = $2 }
  END { exit !(a == 1 && av == "true" && m == 1 && mv == "lexical") }
' "$ai_env_file"
sudo awk -F= '$1 == "AI_EMBEDDING_ENABLED" { n += 1; v = $2 } END { exit !(n == 1 && v == "false") }' "$embedding_env_file"
for name in project-ai-os-staging project-ai-os-staging-worker project-ai-os-staging-embedding-worker project-ai-os-staging-timesheet-worker project-ai-os-staging-workflow-worker; do
  [[ "$(sudo docker inspect --format '{{.Config.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name")" == "$app_image_ref|healthy" ]]
done

sudo docker exec project-ai-os-staging npm run ai:probe:qwen >/dev/null
embedding_probe="$(sudo docker exec project-ai-os-staging-embedding-worker npm run embeddings:probe)"
grep -q '"model":"text-embedding-v4"' <<<"$embedding_probe"
grep -q '"dimensions":1024' <<<"$embedding_probe"
grep -q '"finite":true' <<<"$embedding_probe"
"${compose_run[@]}" --env "APP_BASE_URL=http://projectai-staging:3000/tool/projectai-staging" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" --env "STAGING_AUTH_MODE=mock-wecom" \
  projectai-ai-smoke npm run assistant:smoke

embedding_temp="$(sudo mktemp "$remote_dir/.env.embedding.v3-enable.XXXXXX")"
sudo awk -F= '$1 == "AI_EMBEDDING_ENABLED" { print "AI_EMBEDDING_ENABLED=true"; n += 1; next } { print } END { if (n != 1) exit 1 }' \
  "$embedding_env_file" | sudo tee "$embedding_temp" >/dev/null
sudo install -m 0600 -o root -g root "$embedding_temp" "$embedding_env_file"; sudo unlink "$embedding_temp"
"${compose[@]}" up --detach --no-deps --force-recreate --no-build --pull never projectai-document-worker projectai-embedding-worker projectai-staging
for _ in $(seq 1 90); do
  body="$(curl --fail --silent --show-error --max-time 5 "$origin/api/health" || true)"
  if grep -q '"status":"ok"' <<<"$body" && grep -q '"aiEmbeddingEnabled":true' <<<"$body" \
    && grep -q '"pgvectorReady":true' <<<"$body"; then embedding_ready=1; break; fi
  sleep 2
done
[[ "${embedding_ready:-0}" == "1" ]]
grep -q ' enabled$' < <(sudo docker exec project-ai-os-staging-embedding-worker sh -ec 'cat /tmp/projectai-embedding-worker-heartbeat')

for _ in $(seq 1 13); do sleep 5; done
smoke_id="$(sudo docker exec project-ai-os-staging node -e 'process.stdout.write(crypto.randomUUID())')"
[[ "$smoke_id" =~ ^[0-9a-f-]{36}$ ]]
"${compose[@]}" stop --timeout 45 projectai-embedding-worker
"${compose_run[@]}" --env "APP_BASE_URL=http://projectai-staging:3000/tool/projectai-staging" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" --env "EMBEDDING_SMOKE_RUN_ID=$smoke_id" \
  --env "STAGING_AUTH_MODE=mock-wecom" \
  projectai-document-smoke npm run embeddings:smoke:prepare
"${compose_run[@]}" --env "EMBEDDING_SMOKE_RUN_ID=$smoke_id" projectai-document-smoke npm run embeddings:lease-smoke
"${compose[@]}" up --detach --no-build --pull never projectai-embedding-worker
for _ in $(seq 1 60); do
  [[ "$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' project-ai-os-staging-embedding-worker)" == "healthy" ]] && worker_ready=1 && break
  sleep 2
done
[[ "${worker_ready:-0}" == "1" ]]
"${compose_run[@]}" --env "APP_BASE_URL=http://projectai-staging:3000/tool/projectai-staging" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" --env "EMBEDDING_SMOKE_RUN_ID=$smoke_id" \
  --env "STAGING_AUTH_MODE=mock-wecom" \
  projectai-document-smoke npm run embeddings:smoke:verify

for _ in $(seq 1 13); do sleep 5; done
"${compose_run[@]}" --env "APP_BASE_URL=http://projectai-staging:3000/tool/projectai-staging" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" --env "STAGING_AUTH_MODE=mock-wecom" \
  projectai-ai-smoke npm run assistant:smoke
evaluation="$(sudo docker exec project-ai-os-staging npm run retrieval:evaluate)"
grep -q '"passed":true' <<<"$evaluation"
evaluation_digest="$(sudo docker exec project-ai-os-staging sha256sum review-artifacts/retrieval-evaluation.json | awk '{print $1}')"
[[ "$evaluation_digest" =~ ^[0-9a-f]{64}$ ]]
probe="$(sudo docker exec project-ai-os-staging npm run retrieval:probe)"
grep -q '"dimensions":1024' <<<"$probe"; grep -q '"finite":true' <<<"$probe"; grep -q '"projectScoped":true' <<<"$probe"

set_mode() {
  mode="$1"
  temp="$(sudo mktemp "$remote_dir/.env.ai.v3-mode.XXXXXX")"
  sudo awk -F= -v mode="$mode" '$1 == "AI_ASSISTANT_RETRIEVAL_MODE" { print "AI_ASSISTANT_RETRIEVAL_MODE=" mode; n += 1; next } { print } END { if (n != 1) exit 1 }' \
    "$ai_env_file" | sudo tee "$temp" >/dev/null
  sudo install -m 0600 -o deploy -g deploy "$temp" "$ai_env_file"; sudo unlink "$temp"
  "${compose[@]}" up --detach --no-deps --force-recreate --no-build --pull never projectai-staging
  ready=0
  for _ in $(seq 1 90); do
    body="$(curl --fail --silent --show-error --max-time 5 "$origin/api/health" || true)"
    if grep -q '"status":"ok"' <<<"$body" && grep -q "\"assistantRetrievalMode\":\"$mode\"" <<<"$body" \
      && grep -q '"hybridRetrievalReady":true' <<<"$body"; then ready=1; break; fi
    sleep 2
  done
  [[ "$ready" == "1" ]]
}

set_mode shadow
for _ in $(seq 1 13); do sleep 5; done
"${compose_run[@]}" --env "APP_BASE_URL=http://projectai-staging:3000/tool/projectai-staging" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" --env "EXPECTED_RETRIEVAL_MODE=shadow" \
  --env "STAGING_AUTH_MODE=mock-wecom" \
  projectai-ai-smoke npm run assistant:smoke
shadow="$(sudo docker exec project-ai-os-staging npm run retrieval:shadow-report)"
grep -q '"project_scope_leakage_count":"0"' <<<"$shadow"

set_mode hybrid
for _ in $(seq 1 13); do sleep 5; done
"${compose_run[@]}" --env "APP_BASE_URL=http://projectai-staging:3000/tool/projectai-staging" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" --env "EXPECTED_RETRIEVAL_MODE=hybrid" \
  --env "STAGING_AUTH_MODE=mock-wecom" \
  projectai-ai-smoke npm run assistant:smoke
status="$(sudo docker exec project-ai-os-staging npm run retrieval:status)"
grep -q '"mode":"hybrid"' <<<"$status"; grep -q '"id":"hybrid-rrf-v1"' <<<"$status"
"${compose_run[@]}" projectai-storage-ops npm run storage:verify

for name in project-ai-os-staging project-ai-os-staging-worker project-ai-os-staging-embedding-worker project-ai-os-staging-timesheet-worker project-ai-os-staging-workflow-worker; do
  [[ "$(sudo docker inspect --format '{{.Config.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name")" == "$app_image_ref|healthy" ]]
done
[[ -z "$(sudo docker port project-ai-os-staging-workflow-worker)" ]]
sudo unlink "$ai_backup"; sudo unlink "$embedding_backup"; sudo unlink "$marker"
backed_up=0
trap - ERR EXIT
printf 'V3_STAGING_PROMOTED head=%s mode=hybrid evaluation=%s\n' "$commit_sha" "$evaluation_digest"
REMOTE_PROMOTE

log "V3 Staging promotion completed for ${COMMIT_SHA}"
