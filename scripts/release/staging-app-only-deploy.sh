#!/usr/bin/env bash
set -Eeuo pipefail

remote_dir="$1"
env_file="$2"
embedding_env_file="$3"
compose_project="$4"
compose_file="$5"
app_only_compose_file="$6"
app_image_ref="$7"
app_image_id="$8"
commit_sha="$9"
app_version="${10}"
build_time="${11}"
container_name="${12}"
worker_container_name="${13}"
embedding_worker_container_name="${14}"
db_container_name="${15}"
minio_container_name="${16}"
base_path="${17}"
deploy_marker="${18}"
release_log_file="${19:-}"

[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$env_file" == "$remote_dir/.env.auth-staging" ]]
[[ "$embedding_env_file" == "$remote_dir/.env.embedding" ]]
[[ "$compose_project" == "projectai-staging" ]]
[[ "$compose_file" == "docker-compose.staging.yml" ]]
[[ "$app_only_compose_file" == "docker-compose.staging-app-only.yml" ]]
[[ "$app_image_ref" == "project-ai-os-staging:${commit_sha}" ]]
[[ "$app_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$container_name" == "project-ai-os-staging" ]]
[[ "$worker_container_name" == "project-ai-os-staging-worker" ]]
[[ "$embedding_worker_container_name" == "project-ai-os-staging-embedding-worker" ]]
[[ "$db_container_name" == "project-ai-os-staging-postgres" ]]
[[ "$minio_container_name" == "project-ai-os-staging-minio" ]]
[[ "$base_path" == "/tool/projectai-staging" ]]
[[ "$deploy_marker" == "$remote_dir/.staging-deploy-in-progress" ]]
[[ -z "$release_log_file" || "$release_log_file" == "$remote_dir/deploy-logs/"provider-self-service-*.log ]]

provider_credentials_key_file="$remote_dir/secrets/provider_credentials_key"

log_release_event() {
  local event="$1"
  local check_name="$2"
  local exit_code="$3"
  local error_code="$4"
  [[ -z "$release_log_file" ]] && return 0
  [[ "$event" =~ ^(PHASE|PASS|FAIL|EXIT|ROLLBACK_START|ROLLBACK_COMPLETE|COMMIT|WARNING)$ ]]
  [[ "$check_name" =~ ^[A-Z][A-Z0-9_]{2,80}$ ]]
  [[ "$exit_code" =~ ^[0-9]+$ ]]
  [[ "$error_code" =~ ^(NONE|STAGING_[A-Z0-9_]{3,120})$ ]]
  sudo test -f "$release_log_file"
  printf '%s component=APP_ONLY_HELPER phase=%s event=%s check=%s exit_code=%s error_code=%s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$release_phase" "$event" "$check_name" "$exit_code" "$error_code" | sudo tee -a "$release_log_file" >/dev/null
}

source "$remote_dir/scripts/release/staging-release-guard-state.sh"
release_guard_init

on_app_only_exit() {
  local exit_code=$?
  trap - EXIT
  set +e
  if [[ "$exit_code" -ne 0 ]]; then
    release_guard_record_unhandled_failure "$exit_code" || true
  fi
  log_release_event "EXIT" "APP_ONLY_HELPER" "$exit_code" "$release_error_code" || true
  exit "$exit_code"
}
trap on_app_only_exit EXIT

release_guard_set_phase "VERIFY_STATIC_PREREQUISITES"
cd "$remote_dir"
sudo test -e "$deploy_marker"
sudo test -f "$compose_file"
sudo test -f "$app_only_compose_file"
sudo test -f "$env_file"
sudo test -f "$embedding_env_file"
sudo test -f "$provider_credentials_key_file"
sudo test ! -L "$provider_credentials_key_file"
[[ "$(sudo stat -c '%a' "$provider_credentials_key_file")" == "600" ]]
[[ "$(sudo stat -c '%U:%G' "$provider_credentials_key_file")" == "deploy:deploy" ]]

release_guard_emit "PASS" "STATIC_PREREQUISITES" "0" "NONE"
release_guard_set_phase "VERIFY_DEPENDENCIES"
for service_container in "$db_container_name" "$minio_container_name"; do
  running="$(sudo docker inspect --format '{{.State.Running}}' "$service_container")"
  health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$service_container")"
  [[ "$running" == "true" && "$health" == "healthy" ]]
done

release_guard_emit "PASS" "DEPENDENCIES" "0" "NONE"
release_guard_set_phase "CAPTURE_DATABASE_BASELINE"
database_counts() {
  sudo docker exec "$db_container_name" sh -eu -c '
    psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
      select concat_ws(chr(124),
        (select count(*) from users),
        (select count(*) from accounts),
        (select count(*) from sessions),
        (select count(*) from projects),
        (select count(*) from project_documents),
        (select count(*) from project_document_versions)
      )
    "
  '
}

before_counts="$(database_counts)"
[[ "$before_counts" =~ ^[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+$ ]]

release_guard_emit "PASS" "DATABASE_BASELINE" "0" "NONE"
release_guard_set_phase "VALIDATE_COMPOSE"
compose=(
  sudo env
  "NEXT_PUBLIC_COMMIT_SHA=$commit_sha"
  "NEXT_PUBLIC_APP_VERSION=$app_version"
  "NEXT_PUBLIC_BUILD_TIME=$build_time"
  "STAGING_APP_IMAGE=$app_image_ref"
  "STAGING_WORKER_IMAGE=$app_image_ref"
  "STAGING_EMBEDDING_WORKER_IMAGE=$app_image_ref"
  docker compose
  --env-file "$env_file"
  --env-file "$embedding_env_file"
  --project-name "$compose_project"
  --file "$compose_file"
  --file "$app_only_compose_file"
  --profile embedding
)

"${compose[@]}" config --quiet
release_guard_emit "PASS" "COMPOSE_CONFIGURATION" "0" "NONE"
release_guard_set_phase "REPLACE_STAGING_RUNTIME"
"${compose[@]}" up --detach --no-deps --no-build --pull never \
  projectai-document-worker projectai-embedding-worker projectai-staging

release_guard_emit "PASS" "RUNTIME_REPLACEMENT" "0" "NONE"
release_guard_set_phase "VERIFY_CONTAINER_HEALTH"
for target in \
  "$worker_container_name" \
  "$embedding_worker_container_name" \
  "$container_name"; do
  ready=0
  for _ in $(seq 1 60); do
    health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$target" 2>/dev/null || true)"
    if [[ "$health" == "healthy" ]]; then
      ready=1
      break
    fi
    sleep 2
  done
  [[ "$ready" == "1" ]]
  [[ "$(sudo docker inspect --format '{{.Image}}' "$target")" == "$app_image_id" ]]
  [[ "$(sudo docker inspect --format '{{.RestartCount}}' "$target")" == "0" ]]
done

release_guard_emit "PASS" "CONTAINER_HEALTH" "0" "NONE"
release_guard_set_phase "VERIFY_RUNTIME_METADATA"
app_environment="$(sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_name")"
grep -Fxq "NEXT_PUBLIC_COMMIT_SHA=$commit_sha" <<<"$app_environment"
grep -Fxq "AI_ASSISTANT_ENABLED=true" <<<"$app_environment"
grep -Fxq "AI_PROJECT_ASSISTANT_PROFILE_ID=qwen-project-assistant-cn-v2" <<<"$app_environment"
grep -Fxq "AI_ASSISTANT_RETRIEVAL_MODE=hybrid" <<<"$app_environment"
grep -Fxq "AI_EMBEDDING_ENABLED=true" <<<"$app_environment"
grep -Fxq "AI_EMBEDDING_PROFILE_ID=qwen3.7-text-embedding-cn-v2" <<<"$app_environment"
grep -Fxq "AI_EMBEDDING_DIMENSIONS=1024" <<<"$app_environment"
grep -Fxq "AI_PROVIDER_CREDENTIALS_KEY_FILE=/run/secrets/provider_credentials_key" <<<"$app_environment"

release_guard_emit "PASS" "RUNTIME_METADATA" "0" "NONE"
release_guard_set_phase "VERIFY_SECRET_MOUNTS"
provider_credential_mount_template='{{range .Mounts}}{{if eq .Destination "/run/secrets/provider_credentials_key"}}{{.RW}}|{{.Destination}}{{end}}{{end}}'
release_error_code="STAGING_PROVIDER_CREDENTIAL_KEY_MOUNT_INSPECT_FAILED"
if ! provider_credential_mount="$(
  sudo docker inspect --format "$provider_credential_mount_template" "$container_name"
)"; then
  printf 'STAGING_PROVIDER_CREDENTIAL_KEY_MOUNT_INSPECT_FAILED: App credential mount could not be inspected.\n' >&2
  exit 1
fi
if [[ "$provider_credential_mount" != "false|/run/secrets/provider_credentials_key" ]]; then
  release_error_code="STAGING_PROVIDER_CREDENTIAL_KEY_MOUNT_MISSING"
  printf 'STAGING_PROVIDER_CREDENTIAL_KEY_MOUNT_MISSING: App credential mount is missing or writable.\n' >&2
  exit 1
fi
if ! sudo docker exec "$container_name" node -e 'require("node:fs").accessSync("/run/secrets/provider_credentials_key")'; then
  release_error_code="STAGING_PROVIDER_CREDENTIAL_KEY_UNREADABLE"
  printf 'STAGING_PROVIDER_CREDENTIAL_KEY_UNREADABLE: App cannot read its credential mount.\n' >&2
  exit 1
fi

embedding_environment="$(sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$embedding_worker_container_name")"
grep -Fxq "AI_EMBEDDING_ENABLED=true" <<<"$embedding_environment"
grep -Fxq "AI_EMBEDDING_PROFILE_ID=qwen3.7-text-embedding-cn-v2" <<<"$embedding_environment"
grep -Fxq "AI_EMBEDDING_DIMENSIONS=1024" <<<"$embedding_environment"
for worker_container in "$worker_container_name" "$embedding_worker_container_name"; do
  release_error_code="STAGING_PROVIDER_CREDENTIAL_KEY_MOUNT_INSPECT_FAILED"
  if ! worker_credential_mount="$(
    sudo docker inspect --format "$provider_credential_mount_template" "$worker_container"
  )"; then
    printf 'STAGING_PROVIDER_CREDENTIAL_KEY_MOUNT_INSPECT_FAILED: Worker credential mount could not be inspected.\n' >&2
    exit 1
  fi
  if [[ -n "$worker_credential_mount" ]]; then
    release_error_code="STAGING_PROVIDER_CREDENTIAL_KEY_UNEXPECTED_WORKER_MOUNT"
    printf 'STAGING_PROVIDER_CREDENTIAL_KEY_UNEXPECTED_WORKER_MOUNT: Worker received the App credential mount.\n' >&2
    exit 1
  fi
done

release_guard_emit "PASS" "SECRET_MOUNTS" "0" "NONE"
release_guard_set_phase "VERIFY_LOCAL_HEALTH"
release_error_code="STAGING_APP_HEALTHCHECK_FAILED"
if ! curl --fail --silent --max-time 10 \
  --header "Host: gridworks.cn" \
  "http://127.0.0.1:3101${base_path}/api/health" | grep -q '"status":"ok"'; then
  printf 'STAGING_APP_HEALTHCHECK_FAILED: local health endpoint rejected the deployment.\n' >&2
  exit 1
fi

release_guard_emit "PASS" "LOCAL_HEALTH" "0" "NONE"
release_guard_set_phase "VERIFY_LOCAL_LOGIN"
release_error_code="STAGING_LOGIN_CHECK_FAILED"
if ! curl --fail --silent --max-time 10 \
  --header "Host: gridworks.cn" \
  "http://127.0.0.1:3101${base_path}/login" >/dev/null; then
  printf 'STAGING_LOGIN_CHECK_FAILED: local login endpoint rejected the deployment.\n' >&2
  exit 1
fi
release_guard_emit "PASS" "LOCAL_LOGIN" "0" "NONE"
release_guard_set_phase "VERIFY_DATABASE_COUNTS"
after_counts="$(database_counts)"
[[ "$after_counts" == "$before_counts" ]]

release_guard_emit "PASS" "DATABASE_COUNTS" "0" "NONE"
printf 'App-only Staging deployment completed without Migration, Seed, password reset, or credential-based E2E.\n'
printf 'Preserved row counts (users|accounts|sessions|projects|documents|versions): %s\n' "$after_counts"
