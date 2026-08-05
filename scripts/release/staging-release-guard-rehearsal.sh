#!/usr/bin/env bash
set -Eeuo pipefail

remote_dir="$1"
env_file="$2"
ai_env_file="$3"
embedding_env_file="$4"
app_image_ref="$5"
app_image_id="$6"
application_head="$7"
app_version="$8"
base_path="$9"
release_log_file="${10}"

readonly rehearsal_container="projectai-staging-release-guard-rehearsal"
readonly provider_credentials_key_file="${remote_dir}/secrets/provider_credentials_key"
readonly internal_network="projectai-staging-internal"

[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$env_file" == "$remote_dir/.env.auth-staging" ]]
[[ "$ai_env_file" == "$remote_dir/.env.ai" ]]
[[ "$embedding_env_file" == "$remote_dir/.env.embedding" ]]
[[ "$app_image_ref" == "project-ai-os-staging:${application_head}" ]]
[[ "$app_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$application_head" =~ ^[0-9a-f]{40}$ ]]
[[ "$app_version" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]
[[ "$base_path" == "/tool/projectai-staging" ]]
[[ "$release_log_file" == "$remote_dir/deploy-logs/"provider-self-service-rehearsal-*.log ]]

release_phase="INITIALIZING"
release_error_code="STAGING_RELEASE_GUARD_REHEARSAL_FAILED"

log_event() {
  local event="$1"
  local check_name="$2"
  local exit_code="$3"
  local error_code="$4"
  [[ "$event" =~ ^(PHASE|PASS|FAIL|EXIT|CLEANUP)$ ]]
  [[ "$check_name" =~ ^[A-Z][A-Z0-9_]{2,80}$ ]]
  [[ "$exit_code" =~ ^[0-9]+$ ]]
  [[ "$error_code" =~ ^(NONE|STAGING_[A-Z0-9_]{3,120})$ ]]
  sudo install -d -m 0700 -o root -g root "$remote_dir/deploy-logs"
  sudo test -f "$release_log_file" || sudo install -m 0600 -o root -g root /dev/null "$release_log_file"
  printf '%s component=RELEASE_GUARD_REHEARSAL phase=%s event=%s check=%s exit_code=%s error_code=%s application_head=%s application_digest=%s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$release_phase" "$event" "$check_name" "$exit_code" "$error_code" "$application_head" "$app_image_id" | sudo tee -a "$release_log_file" >/dev/null
}

set_phase() {
  release_phase="$1"
  [[ "$release_phase" =~ ^[A-Z][A-Z0-9_]{2,80}$ ]]
  log_event "PHASE" "$release_phase" "0" "NONE"
}

cleanup() {
  local exit_code=$?
  trap - EXIT
  set +e
  sudo docker rm --force "$rehearsal_container" >/dev/null 2>&1
  if [[ "$exit_code" -eq 0 ]]; then
    log_event "CLEANUP" "REHEARSAL_CONTAINER" "0" "NONE" || true
  else
    log_event "FAIL" "$release_phase" "$exit_code" "$release_error_code" || true
  fi
  log_event "EXIT" "REHEARSAL" "$exit_code" "$release_error_code" || true
  exit "$exit_code"
}
trap cleanup EXIT

cd "$remote_dir"
set_phase "VERIFY_REHEARSAL_PREREQUISITES"
sudo test -f "$env_file"
sudo test -f "$ai_env_file"
sudo test -f "$embedding_env_file"
sudo test -f "$provider_credentials_key_file"
sudo test ! -L "$provider_credentials_key_file"
[[ "$(sudo stat -c '%a' "$provider_credentials_key_file")" == "600" ]]
[[ "$(sudo docker image inspect --format '{{.Id}}' "$app_image_ref")" == "$app_image_id" ]]
[[ "$(sudo docker image inspect --format '{{index .Config.Labels `org.opencontainers.image.revision`}}' "$app_image_ref")" == "$application_head" ]]
[[ "$(sudo docker network inspect --format '{{.Name}}' "$internal_network")" == "$internal_network" ]]
for container in project-ai-os-staging-postgres project-ai-os-staging-minio; do
  [[ "$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container")" == "healthy" ]]
done
log_event "PASS" "REHEARSAL_PREREQUISITES" "0" "NONE"

set_phase "START_ISOLATED_CANDIDATE"
sudo docker rm --force "$rehearsal_container" >/dev/null 2>&1 || true
sudo docker run --detach --name "$rehearsal_container" --network "$internal_network" \
  --env-file "$env_file" \
  --env-file "$ai_env_file" \
  --env-file "$embedding_env_file" \
  --env "NODE_ENV=production" \
  --env "PORT=3000" \
  --env "HOST=0.0.0.0" \
  --env "NEXT_PUBLIC_BASE_PATH=$base_path" \
  --env "NEXT_PUBLIC_APP_ENV=staging" \
  --env "NEXT_PUBLIC_APP_VERSION=$app_version" \
  --env "NEXT_PUBLIC_COMMIT_SHA=$application_head" \
  --env "NEXT_PUBLIC_BUILD_TIME=$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --env "AI_ASSISTANT_RETRIEVAL_MODE=lexical" \
  --env "AI_EMBEDDING_ENABLED=false" \
  --env "AI_PROVIDER_CREDENTIALS_KEY_FILE=/run/secrets/provider_credentials_key" \
  --mount "type=bind,src=$provider_credentials_key_file,dst=/run/secrets/provider_credentials_key,readonly" \
  "$app_image_ref" >/dev/null
log_event "PASS" "ISOLATED_CANDIDATE_STARTED" "0" "NONE"

set_phase "VERIFY_REHEARSAL_RUNTIME"
for _ in $(seq 1 60); do
  health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$rehearsal_container" 2>/dev/null || true)"
  [[ "$health" == "healthy" ]] && break
  sleep 2
done
[[ "${health:-}" == "healthy" ]]
[[ "$(sudo docker inspect --format '{{.Image}}' "$rehearsal_container")" == "$app_image_id" ]]
[[ "$(sudo docker inspect --format '{{.RestartCount}}' "$rehearsal_container")" == "0" ]]
runtime_head="$(sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$rehearsal_container" | sed -n 's/^NEXT_PUBLIC_COMMIT_SHA=//p')"
[[ "$runtime_head" == "$application_head" ]]
mount_template='{{range .Mounts}}{{if eq .Destination "/run/secrets/provider_credentials_key"}}{{.RW}}|{{.Destination}}{{end}}{{end}}'
[[ "$(sudo docker inspect --format "$mount_template" "$rehearsal_container")" == "false|/run/secrets/provider_credentials_key" ]]
sudo docker exec "$rehearsal_container" node -e 'require("node:fs").accessSync("/run/secrets/provider_credentials_key")'
sudo docker exec "$rehearsal_container" node -e 'fetch("http://127.0.0.1:3000/tool/projectai-staging/api/health", { headers: { host: "gridworks.cn" } }).then(async (response) => { if (response.status !== 200 || !(await response.text()).includes("\"status\":\"ok\"")) process.exit(1); }).catch(() => process.exit(1))'
log_event "PASS" "REHEARSAL_RUNTIME" "0" "NONE"

set_phase "VERIFY_REHEARSAL_DATABASE"
migration_state="$(sudo docker exec project-ai-os-staging-postgres sh -eu -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select case when to_regclass(chr(100)||chr(114)||chr(105)||chr(122)||chr(122)||chr(108)||chr(101)||chr(46)||chr(95)||chr(95)||chr(100)||chr(114)||chr(105)||chr(122)||chr(122)||chr(108)||chr(101)||chr(95)||chr(109)||chr(105)||chr(103)||chr(114)||chr(97)||chr(116)||chr(105)||chr(111)||chr(110)||chr(115)) is null then 0 else 1 end"')"
[[ "$migration_state" == "1" ]]
log_event "PASS" "REHEARSAL_DATABASE" "0" "NONE"

log_event "PASS" "RELEASE_GUARD_REHEARSAL_PASSED" "0" "NONE"
printf 'RELEASE_GUARD_REHEARSAL_PASSED\n'
