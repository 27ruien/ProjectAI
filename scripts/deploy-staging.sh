#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_BRANCH="agent/document-processing-index"
REMOTE_HOST="${REMOTE_HOST:-gridworks.cn}"
REMOTE_DIR="${REMOTE_DIR:-/srv/projectai-staging}"
readonly COMPOSE_PROJECT="projectai-staging"
COMPOSE_FILE="docker-compose.staging.yml"
CONTAINER_NAME="project-ai-os-staging"
WORKER_CONTAINER_NAME="project-ai-os-staging-worker"
DB_CONTAINER_NAME="project-ai-os-staging-postgres"
MINIO_CONTAINER_NAME="project-ai-os-staging-minio"
MINIO_VOLUME_NAME="projectai-staging-minio"
MINIO_BUCKET_NAME="projectai-staging-files"
readonly MINIO_IMAGE_REF="quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z"
readonly MINIO_CLIENT_IMAGE_REF="quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z"
REMOTE_ENV_FILE="${REMOTE_DIR}/.env.auth-staging"
DEPLOY_MARKER="${REMOTE_DIR}/.staging-deploy-in-progress"
DEPLOY_LOCK_DIR="${REMOTE_DIR}/.staging-deploy-lock"
readonly BACKUP_RETENTION=10
BASE_PATH="/tool/projectai-staging"
APP_VERSION="${NEXT_PUBLIC_APP_VERSION:-}"
PUBLIC_STAGING_URL="${PUBLIC_STAGING_URL:-https://gridworks.cn/tool/projectai-staging}"
PUBLIC_PRODUCTION_URL="${PUBLIC_PRODUCTION_URL:-https://gridworks.cn/tool/projectai}"
PUBLIC_VALIDATION="${PUBLIC_VALIDATION:-1}"
LOCK_ACQUIRED=0
RELEASE_ROOT=""

log() {
  printf '[projectai-staging] %s\n' "$*"
}

fail() {
  printf '[projectai-staging] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is unavailable: $1"
}

http_code() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$1"
}

content_type() {
  curl --fail --silent --show-error --head --max-time 20 "$1" \
    | tr -d '\r' \
    | awk 'tolower($0) ~ /^content-type:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }'
}

assert_public_mime() {
  local url="$1"
  local kind="$2"
  local actual
  actual="$(content_type "$url")"
  case "$kind:$actual" in
    css:text/css*|js:*javascript*|font:font/woff2*|svg:image/svg+xml*|png:image/png*) ;;
    *) fail "Unexpected ${kind} MIME for ${url}: ${actual:-missing}" ;;
  esac
}

require_command git
require_command ssh
require_command rsync
require_command curl
require_command node
require_command tar
require_command mktemp
require_command docker
require_command gzip

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this script from a Git checkout"
cd "$ROOT_DIR"

if [[ -z "$APP_VERSION" ]]; then
  APP_VERSION="$(node -p 'require("./package.json").version')"
fi

[[ "$REMOTE_DIR" == "/srv/projectai-staging" ]] || fail "REMOTE_DIR must remain isolated at /srv/projectai-staging"
[[ "$COMPOSE_PROJECT" == "projectai-staging" ]] || fail "Compose project must remain projectai-staging"
[[ "$PUBLIC_STAGING_URL" == "https://gridworks.cn/tool/projectai-staging" ]] \
  || fail "PUBLIC_STAGING_URL must remain the reviewed Staging endpoint"
[[ "$PUBLIC_PRODUCTION_URL" == "https://gridworks.cn/tool/projectai" ]] \
  || fail "PUBLIC_PRODUCTION_URL must remain the protected Production endpoint"
[[ "$APP_VERSION" =~ ^[0-9A-Za-z._-]+$ ]] || fail "NEXT_PUBLIC_APP_VERSION contains unsupported characters"
[[ "$PUBLIC_VALIDATION" == "0" || "$PUBLIC_VALIDATION" == "1" ]] \
  || fail "PUBLIC_VALIDATION must be exactly 0 or 1"
[[ -f "$COMPOSE_FILE" ]] || fail "Missing ${COMPOSE_FILE}"

CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" != "main" ]] || fail "Refusing to deploy main"
[[ "$CURRENT_BRANCH" == "$EXPECTED_BRANCH" ]] || fail "Expected branch ${EXPECTED_BRANCH}, found ${CURRENT_BRANCH:-detached HEAD}"
[[ -z "$(git status --porcelain)" ]] || fail "Refusing to deploy a dirty working tree"
git diff --check --cached

COMMIT_SHA="$(git rev-parse HEAD)"
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "Unable to determine a full Commit SHA"
SHORT_SHA="${COMMIT_SHA:0:8}"
DEPLOY_ID="${COMMIT_SHA}-$(date -u +'%Y%m%dT%H%M%SZ')-$$-${RANDOM}"
BUILD_TIME="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
export NEXT_PUBLIC_APP_VERSION="$APP_VERSION"
export NEXT_PUBLIC_COMMIT_SHA="$COMMIT_SHA"
export NEXT_PUBLIC_BUILD_TIME="$BUILD_TIME"

SSH=(ssh -o BatchMode=yes "$REMOTE_HOST")

release_deploy_lock() {
  [[ "$LOCK_ACQUIRED" == "1" ]] || return 0
  if ! "${SSH[@]}" bash -s -- "$REMOTE_DIR" "$DEPLOY_LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_UNLOCK'
set -Eeuo pipefail
remote_dir="$1"
lock_dir="$2"
deploy_id="$3"
[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$lock_dir" == "$remote_dir/.staging-deploy-lock" ]]
[[ "$(sudo cat "$lock_dir/deploy-id")" == "$deploy_id" ]]
sudo rm -f "$lock_dir/deploy-id"
sudo rmdir "$lock_dir"
REMOTE_UNLOCK
  then
    return 1
  fi
  LOCK_ACQUIRED=0
}

cleanup_release_root() {
  if [[ -n "$RELEASE_ROOT" && -d "$RELEASE_ROOT" ]]; then
    rm -rf -- "$RELEASE_ROOT"
    RELEASE_ROOT=""
  fi
}

early_cleanup() {
  local exit_code=$?
  trap - EXIT
  set +e
  release_deploy_lock
  [[ $? -eq 0 ]] || exit_code=1
  cleanup_release_root
  exit "$exit_code"
}
trap early_cleanup EXIT

log "Verifying required SSH identity and passwordless sudo"
"${SSH[@]}" 'echo connected && whoami && hostname && sudo -n true && echo sudo-ok'

log "Acquiring the isolated Staging deployment lock"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$DEPLOY_LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_LOCK'
set -Eeuo pipefail
remote_dir="$1"
lock_dir="$2"
deploy_id="$3"
[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$lock_dir" == "$remote_dir/.staging-deploy-lock" ]]
sudo test -d "$remote_dir"
sudo test ! -L "$remote_dir"
[[ "$(sudo readlink -f -- "$remote_dir")" == "$remote_dir" ]]
if ! sudo mkdir -m 0700 "$lock_dir"; then
  printf 'Another Staging deployment lock requires review: %s\n' "$lock_dir" >&2
  exit 1
fi
printf '%s\n' "$deploy_id" | sudo tee "$lock_dir/deploy-id" >/dev/null
sudo chmod 600 "$lock_dir/deploy-id"
REMOTE_LOCK
LOCK_ACQUIRED=1

log "Checking isolated remote prerequisites and protected environment file"
"${SSH[@]}" bash -s -- \
  "$REMOTE_DIR" "$REMOTE_ENV_FILE" "$CONTAINER_NAME" "$WORKER_CONTAINER_NAME" \
  "$DB_CONTAINER_NAME" "$MINIO_CONTAINER_NAME" "$MINIO_VOLUME_NAME" "$MINIO_BUCKET_NAME" \
  "$COMPOSE_PROJECT" "$DEPLOY_MARKER" "$DEPLOY_LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_PREFLIGHT'
set -Eeuo pipefail
remote_dir="$1"
env_file="$2"
container_name="$3"
worker_container_name="$4"
db_container_name="$5"
minio_container_name="$6"
minio_volume_name="$7"
minio_bucket_name="$8"
compose_project="$9"
deploy_marker="${10}"
deploy_lock="${11}"
deploy_id="${12}"
command -v docker >/dev/null 2>&1
command -v curl >/dev/null 2>&1
command -v rsync >/dev/null 2>&1
sudo -n true
sudo docker compose version >/dev/null

port_owner="$(sudo docker ps --filter publish=3101 --format '{{.Names}}' | sed -n '1p')"
if [[ -n "$port_owner" && "$port_owner" != "$container_name" ]]; then
  printf 'Port 3101 is already owned by container %s\n' "$port_owner" >&2
  exit 1
fi

[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$env_file" == "$remote_dir/.env.auth-staging" ]]
[[ "$compose_project" == "projectai-staging" ]]
[[ "$deploy_marker" == "$remote_dir/.staging-deploy-in-progress" ]]
[[ "$deploy_lock" == "$remote_dir/.staging-deploy-lock" ]]
[[ "$(sudo cat "$deploy_lock/deploy-id")" == "$deploy_id" ]]
sudo test -d "$remote_dir"
sudo test ! -L "$remote_dir"
[[ "$(sudo readlink -f -- "$remote_dir")" == "$remote_dir" ]]
sudo test ! -e "$deploy_marker" || {
  printf 'A prior Staging deployment marker requires manual review: %s\n' "$deploy_marker" >&2
  exit 1
}
sudo test -f "$env_file"
sudo test ! -L "$env_file"
sudo chmod 600 "$env_file"
[[ "$(sudo stat -c '%a' "$env_file")" == "600" ]]
[[ "$(sudo stat -c '%U:%G' "$env_file")" == "root:root" ]]
if sudo test -e "$remote_dir/backups"; then
  sudo test -d "$remote_dir/backups"
  sudo test ! -L "$remote_dir/backups"
  [[ "$(sudo readlink -f -- "$remote_dir/backups")" == "$remote_dir/backups" ]]
fi

required_keys=(
  POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL
  BETTER_AUTH_SECRET BETTER_AUTH_URL AUTH_COOKIE_PREFIX AUTH_TRUSTED_ORIGINS
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD
  OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_REGION OBJECT_STORAGE_BUCKET
  OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY
  OBJECT_STORAGE_FORCE_PATH_STYLE OBJECT_STORAGE_USE_SSL
  MAX_UPLOAD_BYTES UPLOAD_ALLOWED_EXTENSIONS
  DOCUMENT_WORKER_POLL_MS DOCUMENT_WORKER_LEASE_SECONDS
  DOCUMENT_WORKER_MAX_ATTEMPTS
  DOCUMENT_MAX_PAGES DOCUMENT_MAX_SLIDES DOCUMENT_MAX_SHEETS
  DOCUMENT_MAX_ROWS DOCUMENT_MAX_COLUMNS DOCUMENT_MAX_CELLS
  DOCUMENT_MAX_CHARACTERS DOCUMENT_MAX_SECTIONS DOCUMENT_MAX_CHUNKS
  DOCUMENT_PARSE_TIMEOUT_MS
  DOCUMENT_CHUNK_TARGET_CHARS DOCUMENT_CHUNK_OVERLAP_CHARS
  DOCUMENT_CHUNK_MIN_CHARS
  DOCUMENT_PARSER_VERSION DOCUMENT_CHUNKER_VERSION
  SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
  SEED_MANAGER_A_EMAIL SEED_MANAGER_A_PASSWORD
  SEED_MANAGER_B_EMAIL SEED_MANAGER_B_PASSWORD
  SEED_MEMBER_A_EMAIL SEED_MEMBER_A_PASSWORD
  SEED_VIEWER_A_EMAIL SEED_VIEWER_A_PASSWORD
)
for key in "${required_keys[@]}"; do
  key_count="$(sudo awk -F= -v key="$key" '$1 == key { count += 1 } END { print count + 0 }' "$env_file")"
  [[ "$key_count" == "1" ]] || {
    printf 'Protected Staging environment must define %s exactly once.\n' "$key" >&2
    exit 1
  }
  sudo awk -F= -v key="$key" '
    $1 == key && length(substr($0, index($0, "=") + 1)) > 0 { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$env_file" || {
    printf 'Protected Staging environment is missing required variable: %s\n' "$key" >&2
    exit 1
  }
done

if sudo awk -F= '
  $1 == "STAGING_APP_IMAGE" ||
  $1 == "STAGING_WORKER_IMAGE" ||
  $1 == "STAGING_DB_TOOLS_IMAGE" ||
  $1 == "STAGING_MINIO_IMAGE" ||
  $1 == "STAGING_MINIO_CLIENT_IMAGE" ||
  $1 == "STAGING_HEALTHCHECK_PATH" ||
  $1 ~ /^COMPOSE_/ ||
  $1 ~ /^NEXT_PUBLIC_/ { found = 1 }
  END { exit(found ? 0 : 1) }
' "$env_file"; then
  printf 'Protected Staging environment contains a reserved deployment override.\n' >&2
  exit 1
fi

for key in \
  SEED_ADMIN_PASSWORD SEED_MANAGER_A_PASSWORD SEED_MANAGER_B_PASSWORD \
  SEED_MEMBER_A_PASSWORD SEED_VIEWER_A_PASSWORD; do
  sudo awk -F= -v key="$key" '
    $1 == key { value = substr($0, index($0, "=") + 1); exit(length(value) >= 12 ? 0 : 1) }
    END { if (!value) exit 1 }
  ' "$env_file" || {
    printf '%s must contain at least 12 characters.\n' "$key" >&2
    exit 1
  }
done

sudo awk -F= '
  $1 == "POSTGRES_PASSWORD" { value = substr($0, index($0, "=") + 1); exit(length(value) >= 16 ? 0 : 1) }
  END { if (!value) exit 1 }
' "$env_file" || {
  printf 'POSTGRES_PASSWORD must contain at least 16 characters.\n' >&2
  exit 1
}
sudo awk -F= '
  $1 == "BETTER_AUTH_SECRET" { value = substr($0, index($0, "=") + 1); exit(length(value) >= 32 ? 0 : 1) }
  END { if (!value) exit 1 }
' "$env_file" || {
  printf 'BETTER_AUTH_SECRET must contain at least 32 characters.\n' >&2
  exit 1
}
sudo awk -F= '
  $1 == "POSTGRES_DB" { database = substr($0, index($0, "=") + 1) }
  $1 == "POSTGRES_USER" { username = substr($0, index($0, "=") + 1) }
  $1 == "POSTGRES_PASSWORD" { password = substr($0, index($0, "=") + 1) }
  $1 == "DATABASE_URL" { database_url = substr($0, index($0, "=") + 1) }
  END {
    if (database != "projectai_staging" || username != "projectai_staging") exit 1
    if (password !~ /^[A-Za-z0-9._-]{16,}$/) exit 1
    expected = "postgresql://" username ":" password "@projectai-postgres:5432/" database
    exit(database_url == expected ? 0 : 1)
  }
' "$env_file" || {
  printf 'DATABASE_URL must exactly target the isolated projectai_staging database without connection overrides.\n' >&2
  exit 1
}
sudo awk -F= '
  $1 == "BETTER_AUTH_URL" { value = substr($0, index($0, "=") + 1); exit(value == "https://gridworks.cn/tool/projectai-staging/api/auth" ? 0 : 1) }
  END { if (!value) exit 1 }
' "$env_file" || {
  printf 'BETTER_AUTH_URL must use the scoped Staging authentication endpoint.\n' >&2
  exit 1
}
sudo awk -F= '
  $1 == "AUTH_COOKIE_PREFIX" { value = substr($0, index($0, "=") + 1); exit(value == "projectai_staging" ? 0 : 1) }
  END { if (!value) exit 1 }
' "$env_file" || {
  printf 'AUTH_COOKIE_PREFIX must be projectai_staging.\n' >&2
  exit 1
}
sudo awk -F= '
  $1 == "AUTH_TRUSTED_ORIGINS" { value = substr($0, index($0, "=") + 1); exit(value == "https://gridworks.cn" ? 0 : 1) }
  END { if (!value) exit 1 }
' "$env_file" || {
  printf 'AUTH_TRUSTED_ORIGINS must be https://gridworks.cn.\n' >&2
  exit 1
}
sudo awk -F= -v expected_bucket="$minio_bucket_name" '
  $1 == "MINIO_ROOT_USER" { root_user = substr($0, index($0, "=") + 1) }
  $1 == "MINIO_ROOT_PASSWORD" { root_password = substr($0, index($0, "=") + 1) }
  $1 == "OBJECT_STORAGE_ENDPOINT" { endpoint = substr($0, index($0, "=") + 1) }
  $1 == "OBJECT_STORAGE_REGION" { region = substr($0, index($0, "=") + 1) }
  $1 == "OBJECT_STORAGE_BUCKET" { bucket = substr($0, index($0, "=") + 1) }
  $1 == "OBJECT_STORAGE_ACCESS_KEY" { app_user = substr($0, index($0, "=") + 1) }
  $1 == "OBJECT_STORAGE_SECRET_KEY" { app_password = substr($0, index($0, "=") + 1) }
  $1 == "OBJECT_STORAGE_FORCE_PATH_STYLE" { path_style = substr($0, index($0, "=") + 1) }
  $1 == "OBJECT_STORAGE_USE_SSL" { use_ssl = substr($0, index($0, "=") + 1) }
  $1 == "MAX_UPLOAD_BYTES" { max_bytes = substr($0, index($0, "=") + 1) }
  $1 == "UPLOAD_ALLOWED_EXTENSIONS" { extensions = substr($0, index($0, "=") + 1) }
  END {
    if (root_user !~ /^[A-Za-z0-9._-]{12,64}$/) exit 1
    if (root_password !~ /^[A-Za-z0-9._-]{32,128}$/) exit 1
    if (app_user !~ /^[A-Za-z0-9._-]{12,64}$/) exit 1
    if (app_password !~ /^[A-Za-z0-9._-]{32,128}$/) exit 1
    if (root_user == app_user || root_password == app_password) exit 1
    if (endpoint != "http://projectai-minio:9000") exit 1
    if (region != "us-east-1" || bucket != expected_bucket) exit 1
    if (path_style != "true" || use_ssl != "false") exit 1
    if (max_bytes != "52428800") exit 1
    if (extensions != "pdf,docx,xlsx,pptx,txt,md") exit 1
  }
' "$env_file" || {
  printf 'Staging object-storage configuration is invalid or not least-privileged.\n' >&2
  exit 1
}
sudo awk -F= '
  {
    values[$1] = substr($0, index($0, "=") + 1)
  }
  END {
    if (values["DOCUMENT_WORKER_POLL_MS"] != "2000") exit 1
    if (values["DOCUMENT_WORKER_LEASE_SECONDS"] != "120") exit 1
    if (values["DOCUMENT_WORKER_MAX_ATTEMPTS"] != "3") exit 1
    if (values["DOCUMENT_MAX_PAGES"] != "1000") exit 1
    if (values["DOCUMENT_MAX_SLIDES"] != "1000") exit 1
    if (values["DOCUMENT_MAX_SHEETS"] != "100") exit 1
    if (values["DOCUMENT_MAX_ROWS"] != "100000") exit 1
    if (values["DOCUMENT_MAX_COLUMNS"] != "1000") exit 1
    if (values["DOCUMENT_MAX_CELLS"] != "500000") exit 1
    if (values["DOCUMENT_MAX_CHARACTERS"] != "10000000") exit 1
    if (values["DOCUMENT_MAX_SECTIONS"] != "20000") exit 1
    if (values["DOCUMENT_MAX_CHUNKS"] != "50000") exit 1
    if (values["DOCUMENT_PARSE_TIMEOUT_MS"] != "120000") exit 1
    if (values["DOCUMENT_CHUNK_TARGET_CHARS"] != "1800") exit 1
    if (values["DOCUMENT_CHUNK_OVERLAP_CHARS"] != "200") exit 1
    if (values["DOCUMENT_CHUNK_MIN_CHARS"] != "120") exit 1
    if (values["DOCUMENT_PARSER_VERSION"] != "1") exit 1
    if (values["DOCUMENT_CHUNKER_VERSION"] != "1") exit 1
  }
' "$env_file" || {
  printf 'Staging document-processing limits or versions do not match the reviewed B2 contract.\n' >&2
  exit 1
}

minimum_free_bytes=3221225472
release_free_bytes="$(sudo df -PB1 "$remote_dir" | awk 'NR == 2 { print $4 }')"
docker_root="$(sudo docker info --format '{{.DockerRootDir}}')"
docker_free_bytes="$(sudo df -PB1 "$docker_root" | awk 'NR == 2 { print $4 }')"
[[ "$release_free_bytes" =~ ^[0-9]+$ && "$docker_free_bytes" =~ ^[0-9]+$ ]]
(( release_free_bytes >= minimum_free_bytes )) || {
  printf 'Staging release filesystem has less than 3 GiB free.\n' >&2
  exit 1
}
(( docker_free_bytes >= minimum_free_bytes )) || {
  printf 'Docker filesystem has less than 3 GiB free.\n' >&2
  exit 1
}

if sudo docker inspect "$db_container_name" >/dev/null 2>&1; then
  db_project="$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$db_container_name")"
  [[ "$db_project" == "$compose_project" ]] || {
    printf 'Unexpected Staging PostgreSQL Compose project: %s\n' "${db_project:-missing}" >&2
    exit 1
  }
  db_mount="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}|{{.Name}}|{{.Destination}}{{end}}{{end}}' "$db_container_name")"
  [[ "$db_mount" == "volume|projectai-staging-postgres|/var/lib/postgresql/data" ]] || {
    printf 'Unexpected or missing Staging PostgreSQL data mount: %s\n' "${db_mount:-missing}" >&2
    exit 1
  }
fi

if sudo docker inspect "$container_name" >/dev/null 2>&1; then
  app_project="$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container_name")"
  [[ "$app_project" == "$compose_project" ]] || {
    printf 'Unexpected Staging application Compose project: %s\n' "${app_project:-missing}" >&2
    exit 1
  }
fi
if sudo docker inspect "$worker_container_name" >/dev/null 2>&1; then
  worker_project="$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$worker_container_name")"
  [[ "$worker_project" == "$compose_project" ]] || {
    printf 'Unexpected Staging document Worker Compose project: %s\n' "${worker_project:-missing}" >&2
    exit 1
  }
  [[ -z "$(sudo docker port "$worker_container_name")" ]] || {
    printf 'Staging document Worker must not publish a host port.\n' >&2
    exit 1
  }
fi

if sudo docker inspect "$minio_container_name" >/dev/null 2>&1; then
  minio_project="$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$minio_container_name")"
  [[ "$minio_project" == "$compose_project" ]] || {
    printf 'Unexpected Staging MinIO Compose project: %s\n' "${minio_project:-missing}" >&2
    exit 1
  }
  minio_mount="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}|{{.Destination}}{{end}}{{end}}' "$minio_container_name")"
  [[ "$minio_mount" == "volume|${minio_volume_name}|/data" ]] || {
    printf 'Unexpected or missing Staging MinIO data mount.\n' >&2
    exit 1
  }
  [[ -z "$(sudo docker port "$minio_container_name")" ]] || {
    printf 'Staging MinIO must not publish a host port.\n' >&2
    exit 1
  }
fi

REMOTE_PREFLIGHT

REMOTE_DOCKER_INFO="$(
  "${SSH[@]}" "sudo docker info --format '{{.OSType}}|{{.Architecture}}'"
)" || fail "Unable to determine the remote Docker platform"
IFS='|' read -r REMOTE_DOCKER_OS REMOTE_DOCKER_ARCH <<<"$REMOTE_DOCKER_INFO"
[[ "$REMOTE_DOCKER_OS" == "linux" ]] || fail "Unsupported remote Docker OS: ${REMOTE_DOCKER_OS:-missing}"
case "$REMOTE_DOCKER_ARCH" in
  amd64|x86_64) REMOTE_DOCKER_ARCH="amd64" ;;
  arm64|aarch64) REMOTE_DOCKER_ARCH="arm64" ;;
  *) fail "Unsupported remote Docker architecture: ${REMOTE_DOCKER_ARCH:-missing}" ;;
esac
REMOTE_DOCKER_PLATFORM="linux/${REMOTE_DOCKER_ARCH}"
[[ "$REMOTE_DOCKER_PLATFORM" == "linux/amd64" || "$REMOTE_DOCKER_PLATFORM" == "linux/arm64" ]] \
  || fail "Unsupported remote Docker platform: ${REMOTE_DOCKER_PLATFORM}"

get_production_state() {
  "${SSH[@]}" \
    "sudo docker inspect --format '{{.Id}} {{.State.Running}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' project-ai-os"
}

PRODUCTION_STATE_BEFORE="$(get_production_state)" \
  || fail "Production container project-ai-os must be running before staging deployment"
read -r _ production_running _ production_health <<<"$PRODUCTION_STATE_BEFORE"
[[ "$production_running" == "true" ]] || fail "Production container is not running before staging deployment"
[[ "$production_health" == "healthy" || "$production_health" == "none" ]] \
  || fail "Production container is not healthy before staging deployment"

PREVIOUS_STAGING_STATE="$("${SSH[@]}" bash -s -- \
  "$CONTAINER_NAME" "$WORKER_CONTAINER_NAME" "$BASE_PATH" <<'REMOTE_IMAGE'
set -Eeuo pipefail
container_name="$1"
worker_container_name="$2"
base_path="$3"
image=""
health_path="/login"
commit_sha=""
app_version=""
build_time=""
worker_image=""
worker_running="0"
if sudo docker container inspect "$container_name" >/dev/null 2>&1; then
  image="$(sudo docker container inspect --format '{{.Image}}' "$container_name")"
  running="$(sudo docker container inspect --format '{{.State.Running}}' "$container_name")"
  health="$(sudo docker container inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name")"
  [[ "$running" == "true" && "$health" == "healthy" ]]
  configured_health_path="$(
    sudo docker container inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_name" \
      | sed -n 's/^STAGING_HEALTHCHECK_PATH=//p'
  )"
  if [[ -n "$configured_health_path" ]]; then
    health_path="$configured_health_path"
  elif curl --fail --silent --max-time 5 \
    "http://127.0.0.1:3101${base_path}/api/health" | grep -q '"status":"ok"'; then
    health_path="/api/health"
  fi
  if [[ "$health_path" == "/api/health" ]]; then
    curl --fail --silent --max-time 5 \
      "http://127.0.0.1:3101${base_path}/api/health" | grep -q '"status":"ok"'
  elif [[ "$health_path" == "/login" ]]; then
    curl --fail --silent --max-time 5 \
      "http://127.0.0.1:3101${base_path}/login" >/dev/null
  else
    printf 'Unsupported previous Staging health path: %s\n' "$health_path" >&2
    exit 1
  fi
  container_environment="$(
    sudo docker container inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_name"
  )"
  commit_sha="$(sed -n 's/^NEXT_PUBLIC_COMMIT_SHA=//p' <<<"$container_environment")"
  app_version="$(sed -n 's/^NEXT_PUBLIC_APP_VERSION=//p' <<<"$container_environment")"
  build_time="$(sed -n 's/^NEXT_PUBLIC_BUILD_TIME=//p' <<<"$container_environment")"
  [[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]]
  [[ "$app_version" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]
  [[ "$build_time" =~ ^[0-9A-Za-z][0-9A-Za-z:._+-]*$ ]]
else
  sudo docker info >/dev/null
fi
if sudo docker container inspect "$worker_container_name" >/dev/null 2>&1; then
  worker_image="$(sudo docker container inspect --format '{{.Image}}' "$worker_container_name")"
  running="$(sudo docker container inspect --format '{{.State.Running}}' "$worker_container_name")"
  health="$(sudo docker container inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$worker_container_name")"
  [[ "$running" == "true" && "$health" == "healthy" ]]
  worker_running="1"
fi
printf '%s|%s|%s|%s|%s|%s|%s\n' \
  "$image" "$health_path" "$commit_sha" "$app_version" "$build_time" \
  "$worker_image" "$worker_running"
REMOTE_IMAGE
)" || fail "Unable to inspect the previous Staging image safely"
IFS='|' read -r \
  PREVIOUS_STAGING_IMAGE PREVIOUS_STAGING_HEALTH_PATH \
  PREVIOUS_STAGING_COMMIT_SHA PREVIOUS_STAGING_APP_VERSION \
  PREVIOUS_STAGING_BUILD_TIME PREVIOUS_STAGING_WORKER_IMAGE \
  PREVIOUS_STAGING_WORKER_RUNNING <<<"$PREVIOUS_STAGING_STATE"
[[ -z "$PREVIOUS_STAGING_IMAGE" || "$PREVIOUS_STAGING_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail "Unable to capture the immutable previous Staging image ID"
[[ "$PREVIOUS_STAGING_HEALTH_PATH" == "/login" || "$PREVIOUS_STAGING_HEALTH_PATH" == "/api/health" ]] \
  || fail "Unable to determine the previous Staging health contract"
if [[ -n "$PREVIOUS_STAGING_IMAGE" ]]; then
  [[ "$PREVIOUS_STAGING_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] \
    || fail "Unable to capture the previous Staging Commit provenance"
  [[ "$PREVIOUS_STAGING_APP_VERSION" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]] \
    || fail "Unable to capture the previous Staging version provenance"
  [[ "$PREVIOUS_STAGING_BUILD_TIME" =~ ^[0-9A-Za-z][0-9A-Za-z:._+-]*$ ]] \
    || fail "Unable to capture the previous Staging build-time provenance"
fi
[[ "$PREVIOUS_STAGING_WORKER_RUNNING" == "0" || "$PREVIOUS_STAGING_WORKER_RUNNING" == "1" ]] \
  || fail "Unable to determine the previous Staging Worker state"
if [[ "$PREVIOUS_STAGING_WORKER_RUNNING" == "1" ]]; then
  [[ "$PREVIOUS_STAGING_WORKER_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "Unable to capture the immutable previous Staging Worker image ID"
fi

rollback_staging_if_marked() {
  "${SSH[@]}" bash -s -- \
    "$REMOTE_DIR" "$REMOTE_ENV_FILE" "$COMPOSE_PROJECT" "$COMPOSE_FILE" \
    "$CONTAINER_NAME" "$WORKER_CONTAINER_NAME" "$DB_CONTAINER_NAME" \
    "$BASE_PATH" "$DEPLOY_MARKER" \
    "$PREVIOUS_STAGING_IMAGE" "$PREVIOUS_STAGING_HEALTH_PATH" \
    "$PREVIOUS_STAGING_COMMIT_SHA" "$PREVIOUS_STAGING_APP_VERSION" \
    "$PREVIOUS_STAGING_BUILD_TIME" "$PREVIOUS_STAGING_WORKER_IMAGE" \
    "$PREVIOUS_STAGING_WORKER_RUNNING" <<'REMOTE_ROLLBACK'
set -Eeuo pipefail
remote_dir="$1"
env_file="$2"
compose_project="$3"
compose_file="$4"
container_name="$5"
worker_container_name="$6"
db_container_name="$7"
base_path="$8"
deploy_marker="$9"
previous_image="${10}"
previous_health_path="${11}"
previous_commit_sha="${12}"
previous_app_version="${13}"
previous_build_time="${14}"
previous_worker_image="${15}"
previous_worker_running="${16}"

[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$compose_project" == "projectai-staging" ]]
[[ "$previous_health_path" == "/login" || "$previous_health_path" == "/api/health" ]]
if [[ -n "$previous_image" ]]; then
  [[ "$previous_commit_sha" =~ ^[0-9a-f]{40}$ ]]
  [[ "$previous_app_version" =~ ^[0-9A-Za-z][0-9A-Za-z._+-]*$ ]]
  [[ "$previous_build_time" =~ ^[0-9A-Za-z][0-9A-Za-z:._+-]*$ ]]
fi
sudo test -e "$deploy_marker" || exit 0
cd "$remote_dir"

rollback_health_path="$previous_health_path"
previous_requires_database="0"
[[ "$previous_health_path" != "/api/health" ]] || previous_requires_database="1"

compose=(
  sudo env
  "NEXT_PUBLIC_COMMIT_SHA=$previous_commit_sha"
  "NEXT_PUBLIC_APP_VERSION=$previous_app_version"
  "NEXT_PUBLIC_BUILD_TIME=$previous_build_time"
  "STAGING_HEALTHCHECK_PATH=$rollback_health_path"
  docker compose
  --env-file "$env_file"
  --project-name "$compose_project"
  --file "$compose_file"
)

if [[ -n "$previous_image" ]]; then
  printf 'Restoring the previously running Staging application image.\n' >&2
  rollback_compose=(
    sudo env
    "NEXT_PUBLIC_COMMIT_SHA=$previous_commit_sha"
    "NEXT_PUBLIC_APP_VERSION=$previous_app_version"
    "NEXT_PUBLIC_BUILD_TIME=$previous_build_time"
    "STAGING_APP_IMAGE=$previous_image"
    "STAGING_WORKER_IMAGE=${previous_worker_image:-$previous_image}"
    "STAGING_HEALTHCHECK_PATH=$rollback_health_path"
    docker compose
    --env-file "$env_file"
    --project-name "$compose_project"
    --file "$compose_file"
  )
  "${rollback_compose[@]}" stop --timeout 30 projectai-document-worker >/dev/null 2>&1 || true
  "${rollback_compose[@]}" up --detach --no-deps --no-build --pull never projectai-staging

  restored=0
  for _ in $(seq 1 60); do
    health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true)"
    if [[ "$health" == "healthy" ]]; then
      if [[ "$previous_requires_database" == "1" ]]; then
        db_health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container_name" 2>/dev/null || true)"
        if [[ "$db_health" == "healthy" ]] \
          && curl --fail --silent --max-time 5 "http://127.0.0.1:3101${base_path}/api/health" \
            | grep -q '"status":"ok"'; then
          restored=1
          break
        fi
      elif curl --fail --silent --max-time 5 "http://127.0.0.1:3101${base_path}/login" >/dev/null; then
        restored=1
        break
      fi
    fi
    sleep 2
  done
  [[ "$restored" == "1" ]]
  [[ "$(sudo docker inspect --format '{{.Image}}' "$container_name")" == "$previous_image" ]]
  restored_environment="$(
    sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_name"
  )"
  [[ "$(sed -n 's/^NEXT_PUBLIC_COMMIT_SHA=//p' <<<"$restored_environment")" == "$previous_commit_sha" ]]
  [[ "$(sed -n 's/^NEXT_PUBLIC_APP_VERSION=//p' <<<"$restored_environment")" == "$previous_app_version" ]]
  [[ "$(sed -n 's/^NEXT_PUBLIC_BUILD_TIME=//p' <<<"$restored_environment")" == "$previous_build_time" ]]
  if [[ "$previous_worker_running" == "1" ]]; then
    [[ "$previous_worker_image" =~ ^sha256:[0-9a-f]{64}$ ]]
    "${rollback_compose[@]}" up --detach --no-deps --no-build --pull never projectai-document-worker
    worker_restored=0
    for _ in $(seq 1 60); do
      worker_health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$worker_container_name" 2>/dev/null || true)"
      if [[ "$worker_health" == "healthy" ]]; then
        worker_restored=1
        break
      fi
      sleep 2
    done
    [[ "$worker_restored" == "1" ]]
    [[ "$(sudo docker inspect --format '{{.Image}}' "$worker_container_name")" == "$previous_worker_image" ]]
  else
    "${rollback_compose[@]}" rm --stop --force projectai-document-worker >/dev/null 2>&1 || true
  fi
else
  printf 'No previous Staging image exists; stopping the failed application and Worker while preserving PostgreSQL.\n' >&2
  "${compose[@]}" stop projectai-document-worker projectai-staging
  failed_app_running="$(sudo docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null || printf 'false')"
  [[ "$failed_app_running" != "true" ]]
  failed_worker_running="$(sudo docker inspect --format '{{.State.Running}}' "$worker_container_name" 2>/dev/null || printf 'false')"
  [[ "$failed_worker_running" != "true" ]]
fi

"${compose[@]}" rm --stop --force projectai-minio-init >/dev/null 2>&1 || true
sudo rm -f "$deploy_marker"
REMOTE_ROLLBACK
}

finish_deployment() {
  local exit_code=$?
  local rollback_code=0
  local production_state_after=""
  trap - EXIT
  set +e

  if [[ "$exit_code" -ne 0 ]]; then
    rollback_staging_if_marked
    rollback_code=$?
  fi

  production_state_after="$(get_production_state)"
  if [[ -z "$production_state_after" || "$production_state_after" != "$PRODUCTION_STATE_BEFORE" ]]; then
    printf '[projectai-staging] ERROR: Production container identity, health, or restart state changed during Staging deployment\n' >&2
    exit_code=1
  fi
  if [[ "$rollback_code" -ne 0 ]]; then
    printf '[projectai-staging] ERROR: Automatic Staging application rollback failed; deployment marker was retained\n' >&2
    exit_code=1
  fi

  release_deploy_lock
  if [[ $? -ne 0 ]]; then
    printf '[projectai-staging] ERROR: Staging deployment lock could not be released safely\n' >&2
    exit_code=1
  fi
  cleanup_release_root

  exit "$exit_code"
}
trap finish_deployment EXIT

log "Creating a tracked-file-only release for Commit ${SHORT_SHA}"
RELEASE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/projectai-release.XXXXXX")"
git archive --format=tar "$COMMIT_SHA" | tar -xf - -C "$RELEASE_ROOT"
[[ -f "$RELEASE_ROOT/$COMPOSE_FILE" ]] || fail "Tracked release is missing ${COMPOSE_FILE}"
[[ ! -e "$RELEASE_ROOT/.env.auth-staging" ]] || fail "Tracked release unexpectedly contains a protected environment file"
sensitive_release_paths="$(
  git ls-tree -r --name-only "$COMMIT_SHA" \
    | awk '
      /(^|\/)\.env($|\.)/ && $0 !~ /\.example$/ { print }
      /\.(pem|key|p12|pfx)$/ { print }
      /(^|\/)(id_rsa|id_ed25519)$/ { print }
    '
)"
[[ -z "$sensitive_release_paths" ]] || fail "Tracked release contains a prohibited secret-like path"

APP_IMAGE_REF="project-ai-os-staging:${COMMIT_SHA}"
DB_TOOLS_IMAGE_REF="project-ai-os-staging-db-tools:${COMMIT_SHA}"

log "Building reviewed Staging images locally for ${REMOTE_DOCKER_PLATFORM}"
docker version >/dev/null
docker build \
  --pull \
  --platform "$REMOTE_DOCKER_PLATFORM" \
  --target runner \
  --build-arg "NEXT_PUBLIC_BASE_PATH=$BASE_PATH" \
  --build-arg "NEXT_PUBLIC_APP_ENV=staging" \
  --build-arg "NEXT_PUBLIC_APP_VERSION=$APP_VERSION" \
  --build-arg "NEXT_PUBLIC_COMMIT_SHA=$COMMIT_SHA" \
  --build-arg "NEXT_PUBLIC_BUILD_TIME=$BUILD_TIME" \
  --tag "$APP_IMAGE_REF" \
  "$RELEASE_ROOT"
docker build \
  --pull \
  --platform "$REMOTE_DOCKER_PLATFORM" \
  --target db-tools \
  --tag "$DB_TOOLS_IMAGE_REF" \
  "$RELEASE_ROOT"

APP_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$APP_IMAGE_REF")"
DB_TOOLS_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$DB_TOOLS_IMAGE_REF")"
[[ "$APP_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$DB_TOOLS_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$APP_IMAGE_REF")" == "$REMOTE_DOCKER_PLATFORM" ]]
[[ "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$DB_TOOLS_IMAGE_REF")" == "$REMOTE_DOCKER_PLATFORM" ]]

log "Preparing fixed Staging release directory without moving its protected environment"
"${SSH[@]}" bash -s -- \
  "$REMOTE_DIR" "$DEPLOY_MARKER" "$DEPLOY_LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_RELEASE'
set -Eeuo pipefail
remote_dir="$1"
deploy_marker="$2"
deploy_lock="$3"
deploy_id="$4"
[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$deploy_marker" == "$remote_dir/.staging-deploy-in-progress" ]]
[[ "$deploy_lock" == "$remote_dir/.staging-deploy-lock" ]]
[[ "$(sudo cat "$deploy_lock/deploy-id")" == "$deploy_id" ]]
sudo test ! -e "$deploy_marker"
sudo install -m 0600 -o root -g root /dev/null "$deploy_marker"
sudo install -d -m 0700 -o root -g root "$remote_dir/backups"
sudo test ! -L "$remote_dir/backups"
[[ "$(sudo readlink -f -- "$remote_dir/backups")" == "$remote_dir/backups" ]]
REMOTE_RELEASE

log "Syncing tracked release ${SHORT_SHA} to ${REMOTE_HOST}:${REMOTE_DIR}"

rsync --archive --compress --delete \
  --filter='protect /backups/***' \
  --filter='protect /.env.auth-staging' \
  --filter='protect /.staging-deploy-in-progress' \
  --filter='protect /.staging-deploy-lock/***' \
  --exclude '/.git/' \
  --exclude '/.next/' \
  --exclude '/.open-next/' \
  --exclude '/.vinext/' \
  --exclude '/.wrangler/' \
  --exclude '/dist/' \
  --exclude '/node_modules/' \
  --exclude '/playwright-report/' \
  --exclude '/test-results/' \
  --exclude '/coverage/' \
  --exclude '/backups/' \
  --exclude '/.env' \
  --exclude '/.env.*' \
  --exclude '/.env.auth-staging' \
  --exclude '*.log' \
  --rsh='ssh -o BatchMode=yes' \
  "$RELEASE_ROOT/" "${REMOTE_HOST}:${REMOTE_DIR}/"

log "Transferring locally built Staging images without building on the shared host"
docker save "$APP_IMAGE_REF" "$DB_TOOLS_IMAGE_REF" \
  | gzip -1 \
  | "${SSH[@]}" 'sudo docker load >/dev/null'

"${SSH[@]}" bash -s -- \
  "$APP_IMAGE_REF" "$APP_IMAGE_ID" "$DB_TOOLS_IMAGE_REF" "$DB_TOOLS_IMAGE_ID" \
  "$REMOTE_DOCKER_PLATFORM" <<'REMOTE_IMAGE_VERIFY'
set -Eeuo pipefail
app_image_ref="$1"
app_image_id="$2"
db_tools_image_ref="$3"
db_tools_image_id="$4"
expected_platform="$5"
[[ "$(sudo docker image inspect --format '{{.Id}}' "$app_image_ref")" == "$app_image_id" ]]
[[ "$(sudo docker image inspect --format '{{.Id}}' "$db_tools_image_ref")" == "$db_tools_image_id" ]]
[[ "$(sudo docker image inspect --format '{{.Os}}/{{.Architecture}}' "$app_image_ref")" == "$expected_platform" ]]
[[ "$(sudo docker image inspect --format '{{.Os}}/{{.Architecture}}' "$db_tools_image_ref")" == "$expected_platform" ]]
REMOTE_IMAGE_VERIFY

log "Starting the isolated Staging services from preloaded images"
"${SSH[@]}" bash -s -- \
  "$REMOTE_DIR" "$REMOTE_ENV_FILE" "$COMPOSE_PROJECT" "$COMPOSE_FILE" \
  "$CONTAINER_NAME" "$WORKER_CONTAINER_NAME" "$DB_CONTAINER_NAME" \
  "$MINIO_CONTAINER_NAME" \
  "$MINIO_VOLUME_NAME" "$MINIO_BUCKET_NAME" "$BASE_PATH" "$COMMIT_SHA" \
  "$APP_VERSION" "$BUILD_TIME" "$DEPLOY_MARKER" "$BACKUP_RETENTION" \
  "$APP_IMAGE_REF" "$APP_IMAGE_ID" "$DB_TOOLS_IMAGE_REF" "$DB_TOOLS_IMAGE_ID" \
  "$MINIO_IMAGE_REF" "$MINIO_CLIENT_IMAGE_REF" <<'REMOTE_DEPLOY'
set -Eeuo pipefail
remote_dir="$1"
env_file="$2"
compose_project="$3"
compose_file="$4"
container_name="$5"
worker_container_name="$6"
db_container_name="$7"
minio_container_name="$8"
minio_volume_name="$9"
minio_bucket_name="${10}"
base_path="${11}"
commit_sha="${12}"
app_version="${13}"
build_time="${14}"
deploy_marker="${15}"
backup_retention="${16}"
app_image_ref="${17}"
app_image_id="${18}"
db_tools_image_ref="${19}"
db_tools_image_id="${20}"
minio_image_ref="${21}"
minio_client_image_ref="${22}"
origin='http://127.0.0.1:3101'

cd "$remote_dir"
[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$compose_project" == "projectai-staging" ]]
[[ "$worker_container_name" == "project-ai-os-staging-worker" ]]
[[ "$minio_container_name" == "project-ai-os-staging-minio" ]]
[[ "$minio_volume_name" == "projectai-staging-minio" ]]
[[ "$minio_bucket_name" == "projectai-staging-files" ]]
[[ "$deploy_marker" == "$remote_dir/.staging-deploy-in-progress" ]]
[[ "$backup_retention" =~ ^[1-9][0-9]*$ ]]
[[ "$app_image_ref" == "project-ai-os-staging:${commit_sha}" ]]
[[ "$db_tools_image_ref" == "project-ai-os-staging-db-tools:${commit_sha}" ]]
[[ "$app_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$db_tools_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$minio_image_ref" == quay.io/minio/minio:RELEASE.* ]]
[[ "$minio_client_image_ref" == quay.io/minio/mc:RELEASE.* ]]
sudo test -e "$deploy_marker"
[[ "$(sudo stat -c '%a' "$env_file")" == "600" ]]
[[ "$(sudo docker image inspect --format '{{.Id}}' "$app_image_ref")" == "$app_image_id" ]]
[[ "$(sudo docker image inspect --format '{{.Id}}' "$db_tools_image_ref")" == "$db_tools_image_id" ]]
export NEXT_PUBLIC_COMMIT_SHA="$commit_sha"
export NEXT_PUBLIC_APP_VERSION="$app_version"
export NEXT_PUBLIC_BUILD_TIME="$build_time"

compose=(
  sudo env
  "NEXT_PUBLIC_COMMIT_SHA=$commit_sha"
  "NEXT_PUBLIC_APP_VERSION=$app_version"
  "NEXT_PUBLIC_BUILD_TIME=$build_time"
  "STAGING_APP_IMAGE=$app_image_ref"
  "STAGING_WORKER_IMAGE=$app_image_ref"
  "STAGING_DB_TOOLS_IMAGE=$db_tools_image_ref"
  "STAGING_MINIO_IMAGE=$minio_image_ref"
  "STAGING_MINIO_CLIENT_IMAGE=$minio_client_image_ref"
  docker compose
  --env-file "$env_file"
  --project-name "$compose_project"
  --file "$compose_file"
  --profile operations
)

minio_backup_env=""
cleanup_minio_backup_env() {
  local scoped_env="${minio_backup_env:-}"
  minio_backup_env=""
  if [[ -n "$scoped_env" ]]; then
    sudo rm -f -- "$scoped_env" || true
  fi
}
remote_deploy_error() {
  local exit_code=$?
  trap - ERR
  set +e
  cleanup_minio_backup_env
  "${compose[@]}" ps >&2
  exit "$exit_code"
}
trap remote_deploy_error ERR
trap cleanup_minio_backup_env EXIT

compose_run=(
  "${compose[@]}"
  run
  --rm
  --no-deps
  --pull never
  --interactive=false
  --no-TTY
)

if sudo docker inspect "$db_container_name" >/dev/null 2>&1; then
  existing_db_mount="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}|{{.Name}}|{{.Destination}}{{end}}{{end}}' "$db_container_name")"
  [[ "$existing_db_mount" == "volume|projectai-staging-postgres|/var/lib/postgresql/data" ]] || {
    printf 'Refusing to recreate PostgreSQL with an unexpected data mount: %s\n' "${existing_db_mount:-missing}" >&2
    exit 1
  }
fi
if sudo docker inspect "$minio_container_name" >/dev/null 2>&1; then
  existing_minio_mount="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}|{{.Destination}}{{end}}{{end}}' "$minio_container_name")"
  [[ "$existing_minio_mount" == "volume|${minio_volume_name}|/data" ]] || {
    printf 'Refusing to recreate MinIO with an unexpected data mount.\n' >&2
    exit 1
  }
  [[ -z "$(sudo docker port "$minio_container_name")" ]] || {
    printf 'Refusing to use a Staging MinIO container with a published host port.\n' >&2
    exit 1
  }
fi

printf 'Pulling the pinned MinIO server and client releases.\n'
"${compose[@]}" pull projectai-minio projectai-minio-init >/dev/null
minio_image_id="$(sudo docker image inspect --format '{{.Id}}' "$minio_image_ref")"
minio_client_image_id="$(sudo docker image inspect --format '{{.Id}}' "$minio_client_image_ref")"
[[ "$minio_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$minio_client_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
"${compose[@]}" up --detach --no-build --pull never projectai-postgres projectai-minio

db_ready=0
db_health="starting"
for _ in $(seq 1 60); do
  db_health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$db_container_name")"
  if [[ "$db_health" == "unhealthy" || "$db_health" == "exited" || "$db_health" == "dead" ]]; then
    printf 'Staging PostgreSQL entered terminal state: %s\n' "$db_health" >&2
    exit 1
  fi
  if [[ "$db_health" == "healthy" ]]; then
    db_ready=1
    break
  fi
  sleep 2
done
[[ "$db_ready" == "1" ]] || {
  printf 'Staging PostgreSQL readiness timed out; final health: %s\n' "$db_health" >&2
  exit 1
}

minio_ready=0
minio_health="starting"
for _ in $(seq 1 60); do
  minio_health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$minio_container_name")"
  if [[ "$minio_health" == "unhealthy" || "$minio_health" == "exited" || "$minio_health" == "dead" ]]; then
    printf 'Staging MinIO entered terminal state: %s\n' "$minio_health" >&2
    exit 1
  fi
  if [[ "$minio_health" == "healthy" ]]; then
    minio_ready=1
    break
  fi
  sleep 2
done
[[ "$minio_ready" == "1" ]] || {
  printf 'Staging MinIO readiness timed out; final health: %s\n' "$minio_health" >&2
  exit 1
}
[[ -z "$(sudo docker port "$minio_container_name")" ]] || {
  printf 'Staging MinIO unexpectedly published a host port.\n' >&2
  exit 1
}

printf 'Recreating the idempotent private MinIO Bucket initializer.\n'
"${compose[@]}" up --detach --no-build --pull never --force-recreate projectai-minio-init
minio_init_id="$("${compose[@]}" ps --all --quiet projectai-minio-init)"
[[ -n "$minio_init_id" ]]
minio_init_done=0
for _ in $(seq 1 60); do
  minio_init_state="$(sudo docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}' "$minio_init_id")"
  if [[ "$minio_init_state" == "exited|0" ]]; then
    minio_init_done=1
    break
  fi
  if [[ "$minio_init_state" == exited\|* && "$minio_init_state" != "exited|0" ]]; then
    printf 'Staging MinIO initialization failed.\n' >&2
    exit 1
  fi
  sleep 1
done
[[ "$minio_init_done" == "1" ]] || {
  printf 'Staging MinIO initialization timed out.\n' >&2
  exit 1
}

# Quiesce both writers before taking the PostgreSQL and object snapshots so
# the two independently transactional stores share one boundary.
writers_running=0
for writer_container in "$container_name" "$worker_container_name"; do
  if sudo docker inspect "$writer_container" >/dev/null 2>&1 \
    && [[ "$(sudo docker inspect --format '{{.State.Running}}' "$writer_container")" == "true" ]]; then
    writers_running=1
  fi
done
if [[ "$writers_running" == "1" ]]; then
  printf 'Stopping the Staging application and document Worker briefly for a cross-store snapshot.\n'
  "${compose[@]}" stop --timeout 30 projectai-document-worker projectai-staging
fi

backup_timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_name="projectai-staging-${backup_timestamp}-${commit_sha}.dump"
host_backup="${remote_dir}/backups/${backup_name}"
partial_backup="${host_backup}.partial"

database_size="$(sudo docker exec "$db_container_name" sh -ec '
  PGPASSWORD="$POSTGRES_PASSWORD" psql \
    --host=127.0.0.1 \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command="SELECT pg_database_size(current_database())"
')"
available_bytes="$(sudo df -PB1 "${remote_dir}/backups" | awk 'NR == 2 { print $4 }')"
[[ "$database_size" =~ ^[0-9]+$ && "$available_bytes" =~ ^[0-9]+$ ]]
required_bytes=$((database_size * 2 + 268435456))
if (( available_bytes < required_bytes )); then
  printf 'Insufficient disk space for a safe Staging backup (available=%s required=%s).\n' \
    "$available_bytes" "$required_bytes" >&2
  exit 1
fi

printf 'Creating the protected pre-migration PostgreSQL backup.\n'
stale_partials="$(
  sudo find "${remote_dir}/backups" -maxdepth 1 -type f \
    -name 'projectai-staging-*.dump.partial' -printf '%f\n'
)"
while IFS= read -r stale_partial; do
  [[ -n "$stale_partial" ]] || continue
  [[ "$stale_partial" =~ ^projectai-staging-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}\.dump\.partial$ ]]
  sudo rm -f -- "${remote_dir}/backups/${stale_partial}"
done <<<"$stale_partials"
sudo rm -f "$partial_backup"
sudo install -m 0600 -o root -g root /dev/null "$partial_backup"
if ! sudo docker exec "$db_container_name" sh -ec '
  umask 077
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
    --format=custom \
    --no-owner \
    --no-acl \
    --host=127.0.0.1 \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB"
' | sudo tee "$partial_backup" >/dev/null; then
  sudo rm -f "$partial_backup" || true
  exit 1
fi
if ! sudo test -s "$partial_backup"; then
  printf 'Staging backup archive is empty.\n' >&2
  sudo rm -f "$partial_backup" || true
  exit 1
fi
if ! sudo cat "$partial_backup" \
  | sudo docker exec --interactive "$db_container_name" pg_restore --list >/dev/null; then
  printf 'Staging backup archive validation failed.\n' >&2
  sudo rm -f "$partial_backup" || true
  exit 1
fi
sudo mv "$partial_backup" "$host_backup"
sudo chown root:root "$host_backup"
sudo chmod 600 "$host_backup"
sudo test -s "$host_backup"

printf 'Creating a protected MinIO inventory and mirror backup.\n'
object_backup_root="${remote_dir}/backups/object-storage"
sudo install -d -m 0700 -o root -g root "$object_backup_root"
sudo test ! -L "$object_backup_root"
[[ "$(sudo readlink -f -- "$object_backup_root")" == "$object_backup_root" ]]
object_backup_stem="projectai-staging-objects-${backup_timestamp}-${commit_sha}"
inventory_name="${object_backup_stem}.inventory.jsonl"
mirror_name="${object_backup_stem}.mirror"
inventory_partial="${object_backup_root}/${inventory_name}.partial"
mirror_partial="${object_backup_root}/${mirror_name}.partial"
inventory_backup="${object_backup_root}/${inventory_name}"
mirror_backup="${object_backup_root}/${mirror_name}"

stale_object_partials="$({
  sudo find "$object_backup_root" -mindepth 1 -maxdepth 1 \
    \( -type f -o -type d \) -name 'projectai-staging-objects-*.partial' -printf '%f\n'
} || true)"
while IFS= read -r stale_object_partial; do
  [[ -n "$stale_object_partial" ]] || continue
  [[ "$stale_object_partial" =~ ^projectai-staging-objects-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}\.(inventory\.jsonl|mirror)\.partial$ ]]
  sudo rm -rf -- "${object_backup_root}/${stale_object_partial}"
done <<<"$stale_object_partials"

sudo install -m 0600 -o root -g root /dev/null "$inventory_partial"
sudo install -d -m 0700 -o root -g root "$mirror_partial"

# The protected Staging env also contains database and authentication secrets.
# Export only the four values needed by the third-party MinIO client image.
while IFS='=' read -r storage_key storage_value; do
  case "$storage_key" in
    MINIO_ROOT_USER|MINIO_ROOT_PASSWORD|OBJECT_STORAGE_ENDPOINT|OBJECT_STORAGE_BUCKET)
      export "${storage_key}=${storage_value}"
      ;;
  esac
done < <(sudo cat "$env_file")
for storage_key in \
  MINIO_ROOT_USER MINIO_ROOT_PASSWORD OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET; do
  [[ -n "${!storage_key:-}" ]] || {
    printf 'Protected Staging storage backup environment is incomplete.\n' >&2
    exit 1
  }
done

# sudo intentionally drops the caller environment. Give the MinIO client only
# its four required values through a root-only file, never the full app env.
minio_backup_env="$(sudo mktemp "${object_backup_root}/.minio-backup-env.XXXXXX")"
sudo chown root:root "$minio_backup_env"
sudo chmod 600 "$minio_backup_env"
{
  printf 'MINIO_ROOT_USER=%s\n' "$MINIO_ROOT_USER"
  printf 'MINIO_ROOT_PASSWORD=%s\n' "$MINIO_ROOT_PASSWORD"
  printf 'OBJECT_STORAGE_ENDPOINT=%s\n' "$OBJECT_STORAGE_ENDPOINT"
  printf 'OBJECT_STORAGE_BUCKET=%s\n' "$OBJECT_STORAGE_BUCKET"
} | sudo tee "$minio_backup_env" >/dev/null
[[ "$(sudo stat -c '%a' "$minio_backup_env")" == "600" ]]

minio_backup_run=(
  sudo docker run
  --rm
  --network projectai-staging-internal
  --cpus 0.5
  --memory 256m
  --pids-limit 128
  --log-driver json-file
  --log-opt max-size=10m
  --log-opt max-file=2
  --env-file "$minio_backup_env"
  --mount "type=bind,source=${object_backup_root},target=/backup"
  --entrypoint /bin/sh
)

if ! "${minio_backup_run[@]}" \
  --env "INVENTORY_NAME=${inventory_name}.partial" \
  "$minio_client_image_id" -ec '
    umask 077
    config_dir="$(mktemp -d /tmp/projectai-mc.XXXXXX)"
    trap '\''rm -rf "$config_dir"'\'' EXIT
    mc --quiet --config-dir "$config_dir" alias set admin "$OBJECT_STORAGE_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc --json --config-dir "$config_dir" ls --recursive "admin/$OBJECT_STORAGE_BUCKET" > "/backup/$INVENTORY_NAME"
  '; then
  sudo rm -rf -- "$inventory_partial" "$mirror_partial"
  printf 'Staging MinIO inventory failed.\n' >&2
  exit 1
fi

inventory_count="$(sudo awk 'NF { count += 1 } END { print count + 0 }' "$inventory_partial")"
read -r inventory_size_count inventory_bytes <<<"$(sudo awk '
  match($0, /"size"[[:space:]]*:[[:space:]]*[0-9]+/) {
    value = substr($0, RSTART, RLENGTH)
    sub(/^.*:/, "", value)
    gsub(/[[:space:]]/, "", value)
    count += 1
    bytes += value
  }
  END { print count + 0, bytes + 0 }
' "$inventory_partial")"
[[ "$inventory_count" =~ ^[0-9]+$ && "$inventory_size_count" =~ ^[0-9]+$ && "$inventory_bytes" =~ ^[0-9]+$ ]]
[[ "$inventory_count" == "$inventory_size_count" ]] || {
  printf 'Staging MinIO inventory could not be validated safely.\n' >&2
  exit 1
}

backup_free_bytes="$(sudo df -PB1 "$object_backup_root" | awk 'NR == 2 { print $4 }')"
docker_root="$(sudo docker info --format '{{.DockerRootDir}}')"
docker_free_bytes="$(sudo df -PB1 "$docker_root" | awk 'NR == 2 { print $4 }')"
[[ "$backup_free_bytes" =~ ^[0-9]+$ && "$docker_free_bytes" =~ ^[0-9]+$ ]]
required_object_backup_bytes=$((inventory_bytes + 268435456))
required_restore_bytes=$((inventory_bytes + 268435456))
(( backup_free_bytes >= required_object_backup_bytes )) || {
  printf 'Insufficient disk space for the Staging MinIO mirror backup.\n' >&2
  exit 1
}
(( docker_free_bytes >= required_restore_bytes )) || {
  printf 'Insufficient Docker disk space for the Staging MinIO restore drill.\n' >&2
  exit 1
}

if ! "${minio_backup_run[@]}" \
  --env "MIRROR_NAME=${mirror_name}.partial" \
  "$minio_client_image_id" -ec '
    umask 077
    config_dir="$(mktemp -d /tmp/projectai-mc.XXXXXX)"
    trap '\''rm -rf "$config_dir"'\'' EXIT
    mc --quiet --config-dir "$config_dir" alias set admin "$OBJECT_STORAGE_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc --quiet --config-dir "$config_dir" mirror --retry "admin/$OBJECT_STORAGE_BUCKET" "/backup/$MIRROR_NAME" >/dev/null
  '; then
  sudo rm -rf -- "$inventory_partial" "$mirror_partial"
  printf 'Staging MinIO mirror backup failed.\n' >&2
  exit 1
fi

mirror_count="$(sudo find "$mirror_partial" -type f -printf '.\n' | wc -l | tr -d '[:space:]')"
mirror_bytes="$(sudo find "$mirror_partial" -type f -printf '%s\n' | awk '{ total += $1 } END { print total + 0 }')"
[[ "$mirror_count" == "$inventory_count" && "$mirror_bytes" == "$inventory_bytes" ]] || {
  printf 'Staging MinIO mirror count or size does not match its inventory.\n' >&2
  exit 1
}
sudo chown -R root:root "$mirror_partial"
sudo find "$mirror_partial" -type d -exec chmod 700 {} +
sudo find "$mirror_partial" -type f -exec chmod 600 {} +
sudo mv "$inventory_partial" "$inventory_backup"
sudo mv "$mirror_partial" "$mirror_backup"
sudo chmod 600 "$inventory_backup"

printf 'Restoring the MinIO mirror into an isolated temporary Bucket.\n'
restore_bucket="projectai-restore-${commit_sha:0:12}-${backup_timestamp,,}"
if ! "${minio_backup_run[@]}" \
  --env "MIRROR_NAME=$mirror_name" \
  --env "RESTORE_BUCKET=$restore_bucket" \
  --env "EXPECTED_COUNT=$inventory_count" \
  --env "EXPECTED_BYTES=$inventory_bytes" \
  "$minio_client_image_id" -ec '
    umask 077
    case "$RESTORE_BUCKET" in
      projectai-restore-[a-z0-9-]*) ;;
      *) exit 1 ;;
    esac
    [ "$RESTORE_BUCKET" != "$OBJECT_STORAGE_BUCKET" ]
    config_dir="$(mktemp -d /tmp/projectai-mc.XXXXXX)"
    created=0
    cleanup() {
      if [ "$created" = 1 ]; then
        mc --quiet --config-dir "$config_dir" rb --force "admin/$RESTORE_BUCKET" >/dev/null 2>&1 || true
      fi
      rm -rf "$config_dir"
    }
    trap cleanup EXIT HUP INT TERM
    mc --quiet --config-dir "$config_dir" alias set admin "$OBJECT_STORAGE_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    if mc --quiet --config-dir "$config_dir" stat "admin/$RESTORE_BUCKET" >/dev/null 2>&1; then
      exit 1
    fi
    mc --quiet --config-dir "$config_dir" mb "admin/$RESTORE_BUCKET" >/dev/null
    created=1
    mc --quiet --config-dir "$config_dir" mirror --retry "/backup/$MIRROR_NAME" "admin/$RESTORE_BUCKET" >/dev/null
    restore_usage="$(mc --json --config-dir "$config_dir" du "admin/$RESTORE_BUCKET")"
    case "$restore_usage" in
      *'\''"status":"success"'\''*) ;;
      *) exit 1 ;;
    esac
    restored_count="${restore_usage#*\"objects\":}"
    restored_bytes="${restore_usage#*\"size\":}"
    [ "$restored_count" != "$restore_usage" ]
    [ "$restored_bytes" != "$restore_usage" ]
    restored_count="${restored_count%%,*}"
    restored_bytes="${restored_bytes%%,*}"
    case "$restored_count:$restored_bytes" in
      *[!0-9:]*|:*|*:) exit 1 ;;
    esac
    [ "$restored_count" = "$EXPECTED_COUNT" ]
    [ "$restored_bytes" = "$EXPECTED_BYTES" ]
    mc --quiet --config-dir "$config_dir" rb --force "admin/$RESTORE_BUCKET" >/dev/null
    created=0
    if mc --quiet --config-dir "$config_dir" stat "admin/$RESTORE_BUCKET" >/dev/null 2>&1; then
      exit 1
    fi
  '; then
  printf 'Staging MinIO isolated restore drill failed.\n' >&2
  exit 1
fi

sudo rm -f -- "$minio_backup_env"
sudo test ! -e "$minio_backup_env"
minio_backup_env=""

[[ -z "$(sudo find "$object_backup_root" -mindepth 1 -maxdepth 1 -name '*.partial' -print -quit)" ]] || {
  printf 'A partial Staging MinIO backup remains after validation.\n' >&2
  exit 1
}

obsolete_object_mirrors="$({
  sudo find "$object_backup_root" -mindepth 1 -maxdepth 1 -type d \
    -name 'projectai-staging-objects-*.mirror' -printf '%f\n' \
    | sort -r \
    | tail -n "+$((backup_retention + 1))"
} || true)"
while IFS= read -r obsolete_object_mirror; do
  [[ -n "$obsolete_object_mirror" ]] || continue
  [[ "$obsolete_object_mirror" =~ ^projectai-staging-objects-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}\.mirror$ ]]
  obsolete_object_stem="${obsolete_object_mirror%.mirror}"
  sudo rm -rf -- "${object_backup_root}/${obsolete_object_mirror}"
  sudo rm -f -- "${object_backup_root}/${obsolete_object_stem}.inventory.jsonl"
done <<<"$obsolete_object_mirrors"

obsolete_backups="$(
  sudo find "${remote_dir}/backups" -maxdepth 1 -type f \
    -name 'projectai-staging-*.dump' -printf '%f\n' \
    | sort -r \
    | tail -n "+$((backup_retention + 1))"
)"
while IFS= read -r obsolete_backup; do
  [[ -n "$obsolete_backup" ]] || continue
  [[ "$obsolete_backup" =~ ^projectai-staging-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{40}\.dump$ ]]
  sudo rm -f -- "${remote_dir}/backups/${obsolete_backup}"
done <<<"$obsolete_backups"

printf 'Applying committed PostgreSQL migrations.\n'
"${compose_run[@]}" projectai-migrate node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query(
        "select current_database() as database, current_user as username, inet_server_port() as port",
      );
      const target = result.rows[0];
      if (
        target?.database !== process.env.POSTGRES_DB ||
        target?.username !== process.env.POSTGRES_USER ||
        Number(target?.port) !== 5432
      ) {
        throw new Error("Database identity mismatch");
      }
    } finally {
      await client.end();
    }
  '
"${compose_run[@]}" projectai-migrate npm run db:migrate
printf 'Verifying the required PostgreSQL pg_trgm extension.\n'
"${compose_run[@]}" projectai-migrate node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query(
        "select extversion from pg_extension where extname = $1",
        ["pg_trgm"],
      );
      if (result.rowCount !== 1 || !result.rows[0]?.extversion) {
        throw new Error("pg_trgm extension is unavailable");
      }
    } finally {
      await client.end();
    }
  '
printf 'Applying idempotent Staging seed data.\n'
"${compose_run[@]}" projectai-migrate npm run db:seed
printf 'Enqueuing any stored current document versions missing a processing Job.\n'
"${compose_run[@]}" projectai-migrate npm run documents:enqueue
printf 'Verifying every Staging project retains a project manager.\n'
"${compose_run[@]}" projectai-migrate node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query(`
        select p.id
        from projects p
        where not exists (
          select 1
          from project_members pm
          where pm.project_id = p.id and pm.role = $1
        )
        order by p.id
      `, ["project_manager"]);
      if (result.rowCount !== 0) {
        throw new Error("Staging contains a project without a project_manager");
      }
    } finally {
      await client.end();
    }
  '

printf 'Verifying PostgreSQL and MinIO consistency before application startup.\n'
"${compose_run[@]}" projectai-storage-ops npm run storage:verify

printf 'Starting the independent Staging document Worker.\n'
"${compose[@]}" up --detach --no-build --pull never projectai-document-worker

worker_ready=0
worker_health="starting"
for _ in $(seq 1 60); do
  worker_health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$worker_container_name")"
  if [[ "$worker_health" == "unhealthy" || "$worker_health" == "exited" || "$worker_health" == "dead" ]]; then
    printf 'Staging document Worker entered terminal state: %s\n' "$worker_health" >&2
    exit 1
  fi
  if [[ "$worker_health" == "healthy" ]]; then
    worker_ready=1
    break
  fi
  sleep 2
done
[[ "$worker_ready" == "1" ]] || {
  printf 'Staging document Worker readiness timed out; final health: %s\n' "$worker_health" >&2
  exit 1
}

printf 'Starting the Staging application after the document Worker is healthy.\n'
"${compose[@]}" up --detach --no-build --pull never projectai-staging

ready=0
container_health="starting"
for _ in $(seq 1 60); do
  container_health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name")"
  if [[ "$container_health" == "unhealthy" || "$container_health" == "exited" || "$container_health" == "dead" ]]; then
    printf 'Staging container entered terminal state: %s\n' "$container_health" >&2
    exit 1
  fi
  if [[ "$container_health" == "healthy" ]] \
    && curl --fail --silent --max-time 5 "${origin}${base_path}/api/health" \
      | grep -q '"status":"ok"'; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]] || {
  printf 'Staging readiness timed out; final container health: %s\n' "$container_health" >&2
  exit 1
}

health_headers="$(
  curl --fail --silent --show-error --max-time 10 \
    --dump-header - --output /dev/null "${origin}${base_path}/api/health" \
    | tr -d '\r'
)"
grep -qi "^x-projectai-app-version: ${app_version}$" <<<"$health_headers"
grep -qi '^x-projectai-worker-version: 1$' <<<"$health_headers"
grep -qi '^x-projectai-parser-version: 1$' <<<"$health_headers"
grep -qi '^x-projectai-chunker-version: 1$' <<<"$health_headers"

[[ "$(sudo docker inspect --format '{{.Image}}' "$container_name")" == "$app_image_id" ]]
[[ "$(sudo docker inspect --format '{{.Image}}' "$worker_container_name")" == "$app_image_id" ]]
[[ "$(sudo docker inspect --format '{{.State.Health.Status}}' "$worker_container_name")" == "healthy" ]]
[[ -z "$(sudo docker port "$worker_container_name")" ]]
[[ "$(sudo docker inspect --format '{{.State.Health.Status}}' "$db_container_name")" == "healthy" ]]
[[ "$(sudo docker inspect --format '{{.State.Health.Status}}' "$minio_container_name")" == "healthy" ]]
[[ "$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Name}}|{{.Destination}}{{end}}{{end}}' "$minio_container_name")" == "volume|${minio_volume_name}|/data" ]]
[[ -z "$(sudo docker port "$minio_container_name")" ]]
curl --fail --silent --max-time 10 "${origin}${base_path}/login" >/dev/null

for route in /dashboard /projects /projects/project-002/overview /reviews /settings/ai-models; do
  response="$(curl --silent --show-error --head --max-time 10 "${origin}${base_path}${route}" | tr -d '\r')"
  status="$(awk 'NR == 1 { print $2 }' <<<"$response")"
  location="$(awk 'tolower($0) ~ /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' <<<"$response")"
  [[ "$status" =~ ^30[2378]$ ]]
  [[ "$location" == *"${base_path}/login"* ]]
done

html="$(curl --fail --silent --show-error --max-time 10 "${origin}${base_path}/login")"
grep -q 'STAGING' <<<"$html"
grep -q "${commit_sha:0:8}" <<<"$html"
grep -q 'noindex' <<<"$html"

printf 'Verifying login, Session refresh/logout, role permissions, and project isolation.\n'
"${compose_run[@]}" \
  --env "APP_BASE_URL=http://projectai-staging:3000${base_path}" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  --env "EXPECTED_COOKIE_PATH=${base_path}" \
  --env "EXPECTED_COOKIE_PREFIX=projectai_staging" \
  --env "REQUIRE_SECURE_COOKIE=1" \
  projectai-migrate node scripts/verify-auth-boundaries.mjs

printf 'Verifying real Staging upload, download integrity, versioning, and lifecycle cleanup.\n'
"${compose_run[@]}" \
  --env "APP_BASE_URL=http://projectai-staging:3000${base_path}" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  projectai-file-smoke npm run storage:smoke

printf 'Verifying six-format document processing, lexical search, citations, permissions, and cleanup.\n'
"${compose_run[@]}" \
  --env "APP_BASE_URL=http://projectai-staging:3000${base_path}" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  projectai-document-smoke npm run documents:smoke

printf 'Rechecking PostgreSQL and MinIO consistency after application verification.\n'
"${compose_run[@]}" projectai-storage-ops npm run storage:verify

printf 'Waiting for the document queue to become idle before Lease verification.\n'
"${compose_run[@]}" projectai-migrate node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const deadline = Date.now() + 120000;
      let idle = false;
      while (Date.now() < deadline) {
        const result = await client.query(
          "select count(*)::int as count from document_ingestion_jobs where status in ($1, $2)",
          ["pending", "running"],
        );
        if (result.rows[0]?.count === 0) {
          idle = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!idle) throw new Error("Document queue did not become idle");
    } finally {
      await client.end();
    }
  '

printf 'Stopping the document Worker for exclusive Lease recovery verification.\n'
"${compose[@]}" stop --timeout 30 projectai-document-worker
"${compose_run[@]}" \
  --env "APP_BASE_URL=http://projectai-staging:3000${base_path}" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  projectai-document-smoke npm run documents:lease-smoke

printf 'Restarting the document Worker after Lease verification.\n'
"${compose[@]}" up --detach --no-build --pull never projectai-document-worker
worker_restarted=0
for _ in $(seq 1 60); do
  worker_health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$worker_container_name")"
  if [[ "$worker_health" == "unhealthy" || "$worker_health" == "exited" || "$worker_health" == "dead" ]]; then
    printf 'Staging document Worker failed after Lease verification: %s\n' "$worker_health" >&2
    exit 1
  fi
  if [[ "$worker_health" == "healthy" ]]; then
    worker_restarted=1
    break
  fi
  sleep 2
done
[[ "$worker_restarted" == "1" ]]
[[ "$(sudo docker inspect --format '{{.Image}}' "$worker_container_name")" == "$app_image_id" ]]
unexpected_worker_temp="$(
  sudo docker exec "$worker_container_name" sh -ec \
    "find /tmp -maxdepth 1 -type f -name 'projectai-*' ! -name 'projectai-document-worker-heartbeat' -print"
)"
[[ -z "$unexpected_worker_temp" ]] || {
  printf 'Unexpected document Worker temporary files remain.\n' >&2
  exit 1
}

printf 'Rechecking storage consistency after Lease verification cleanup.\n'
"${compose_run[@]}" projectai-storage-ops npm run storage:verify

css_path="$(grep -oE "${base_path}/assets/[A-Za-z0-9._/-]+\\.css" <<<"$html" | sed -n '1p')"
js_path="$(grep -oE "${base_path}/assets/[A-Za-z0-9._/-]+\\.js" <<<"$html" | sed -n '1p')"
[[ -n "$css_path" && -n "$js_path" ]]

content_type() {
  curl --fail --silent --show-error --head --max-time 10 "$1" \
    | tr -d '\r' \
    | awk 'tolower($0) ~ /^content-type:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }'
}

assert_mime() {
  local url="$1"
  local kind="$2"
  local actual
  actual="$(content_type "$url")"
  case "$kind:$actual" in
    css:text/css*|js:*javascript*|font:font/woff2*|svg:image/svg+xml*|png:image/png*) ;;
    *) printf 'Unexpected %s MIME for %s: %s\n' "$kind" "$url" "${actual:-missing}" >&2; return 1 ;;
  esac
}

# The standalone vinext server serves compiled files at /assets. Nginx performs
# the basePath rewrite for public traffic, so direct upstream checks remove it.
css_origin_path="${css_path#"$base_path"}"
js_origin_path="${js_path#"$base_path"}"
assert_mime "${origin}${css_origin_path}" css
assert_mime "${origin}${js_origin_path}" js

font_path="$(grep -oE '/assets/_vinext_fonts/[A-Za-z0-9._/-]+\.woff2' <<<"$html" | sed -n '1p')"
[[ -n "$font_path" ]]
assert_mime "${origin}${font_path}" font
assert_mime "${origin}${base_path}/favicon.svg" svg
assert_mime "${origin}${base_path}/og.png" png

# Validation only: this script never edits or reloads Nginx.
sudo nginx -t
"${compose[@]}" rm --force projectai-minio-init >/dev/null
REMOTE_DEPLOY

[[ "$(get_production_state)" == "$PRODUCTION_STATE_BEFORE" ]] \
  || fail "Production container identity, health, or restart state changed during Staging deployment"

if [[ "$PUBLIC_VALIDATION" != "1" ]]; then
  log "Public Staging validation skipped for initial upstream-only rollout"
  [[ "$(get_production_state)" == "$PRODUCTION_STATE_BEFORE" ]] \
    || fail "Production changed before the Staging transaction could commit"
  "${SSH[@]}" "sudo rm -f '$DEPLOY_MARKER'"
  log "Staging upstream verified; configure Nginx, then rerun with PUBLIC_VALIDATION=1"
  exit 0
fi

log "Confirming the live Nginx Staging upload proxy contract"
"${SSH[@]}" bash -s -- "$BASE_PATH" <<'REMOTE_NGINX_CONTRACT'
set -Eeuo pipefail
base_path="$1"
[[ "$base_path" == "/tool/projectai-staging" ]]
staging_location="$(sudo nginx -T 2>/dev/null | awk -v path="$base_path" '
  {
    trimmed = $0
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", trimmed)
    if (trimmed == "location ^~ " path "/ {") capture = 1
    if (capture) print
    if (capture && trimmed == "}") exit
  }
')"
[[ -n "$staging_location" ]]
grep -Fq 'proxy_pass http://127.0.0.1:3101;' <<<"$staging_location"
grep -Fq 'client_max_body_size 52m;' <<<"$staging_location"
grep -Fqi 'X-Robots-Tag "noindex, nofollow"' <<<"$staging_location"
REMOTE_NGINX_CONTRACT

log "Validating public Staging login, protected-route redirects, noindex, and assets"
redirect_headers="$(curl --silent --show-error --head --max-time 20 "$PUBLIC_STAGING_URL" | tr -d '\r')"
redirect_code="$(awk 'NR == 1 { print $2 }' <<<"$redirect_headers")"
redirect_location="$(awk 'tolower($0) ~ /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' <<<"$redirect_headers")"
[[ "$redirect_code" == "308" || "$redirect_code" == "301" ]] || fail "Unexpected Staging redirect status: ${redirect_code}"
[[ "$redirect_location" == "${PUBLIC_STAGING_URL}/" ]] \
  || fail "Staging base path did not redirect to the canonical HTTPS URL"

hostile_base_headers="$(curl --silent --show-error --head --max-time 20 \
  --header 'Host: attacker.invalid' "$PUBLIC_STAGING_URL" | tr -d '\r')"
hostile_base_code="$(awk 'NR == 1 { print $2 }' <<<"$hostile_base_headers")"
hostile_base_location="$(awk 'tolower($0) ~ /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' <<<"$hostile_base_headers")"
[[ "$hostile_base_code" == "308" || "$hostile_base_code" == "301" ]] \
  || fail "Hostile-Host Staging base path returned ${hostile_base_code}"
[[ "$hostile_base_location" == "${PUBLIC_STAGING_URL}/" ]] \
  || fail "Staging base redirect trusted an unvalidated Host header"

app_root_ready=0
app_root_code="unavailable"
app_root_location=""
for _ in $(seq 1 15); do
  app_root_headers="$(
    curl --silent --show-error --head --max-time 20 "${PUBLIC_STAGING_URL}/" \
      | tr -d '\r' || true
  )"
  app_root_code="$(awk 'NR == 1 { print $2 }' <<<"$app_root_headers")"
  app_root_location="$(awk 'tolower($0) ~ /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' <<<"$app_root_headers")"
  if [[ "$app_root_code" =~ ^30[2378]$ ]] \
    && [[ "$app_root_location" == "${PUBLIC_STAGING_URL}/dashboard" ]]; then
    app_root_ready=1
    break
  fi
  sleep 2
done
[[ "$app_root_ready" == "1" ]] \
  || fail "Staging application root did not reach the canonical HTTPS dashboard redirect (status ${app_root_code:-missing})"

hostile_app_headers="$(curl --silent --show-error --head --max-time 20 \
  --header 'Host: attacker.invalid' "${PUBLIC_STAGING_URL}/" | tr -d '\r')"
hostile_app_code="$(awk 'NR == 1 { print $2 }' <<<"$hostile_app_headers")"
hostile_app_location="$(awk 'tolower($0) ~ /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }' <<<"$hostile_app_headers")"
[[ "$hostile_app_code" == "404" ]] \
  || fail "Staging application accepted an unvalidated Host header"
[[ -z "$hostile_app_location" ]] \
  || fail "Host-rejected Staging request emitted an unsafe redirect"

login_code="$(http_code "${PUBLIC_STAGING_URL}/login")"
[[ "$login_code" == "200" ]] || fail "Staging login returned ${login_code}"

for route in /dashboard /projects /projects/project-002/overview /reviews /settings/ai-models; do
  code="$(http_code "${PUBLIC_STAGING_URL}${route}")"
  [[ "$code" =~ ^30[2378]$ ]] || fail "Anonymous Staging route ${route} returned ${code}, expected a login redirect"
  location="$(curl --silent --show-error --head --max-time 20 "${PUBLIC_STAGING_URL}${route}" \
    | tr -d '\r' \
    | awk 'tolower($0) ~ /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }')"
  [[ "$location" == "${PUBLIC_STAGING_URL}/login" || "$location" == "${PUBLIC_STAGING_URL}/login?"* ]] \
    || fail "Staging route ${route} did not redirect to the canonical HTTPS login page"
done

staging_headers="$(curl --fail --silent --show-error --head --max-time 20 "${PUBLIC_STAGING_URL}/login" | tr -d '\r')"
grep -qi '^x-robots-tag:.*noindex.*nofollow' <<<"$staging_headers" \
  || fail "Staging response is missing X-Robots-Tag noindex, nofollow"

public_html="$(curl --fail --silent --show-error --max-time 20 "${PUBLIC_STAGING_URL}/login")"
grep -q 'STAGING' <<<"$public_html" || fail "Public Staging page is missing the STAGING marker"
grep -q "$SHORT_SHA" <<<"$public_html" || fail "Public Staging page is missing Commit ${SHORT_SHA}"
grep -q 'noindex' <<<"$public_html" || fail "Public Staging page is missing robots noindex metadata"

public_css_path="$(grep -oE "${BASE_PATH}/assets/[A-Za-z0-9._/-]+\\.css" <<<"$public_html" | sed -n '1p')"
public_js_path="$(grep -oE "${BASE_PATH}/assets/[A-Za-z0-9._/-]+\\.js" <<<"$public_html" | sed -n '1p')"
[[ -n "$public_css_path" && -n "$public_js_path" ]] || fail "Unable to discover public CSS and JS assets"
assert_public_mime "https://gridworks.cn${public_css_path}" css
assert_public_mime "https://gridworks.cn${public_js_path}" js

public_font_path="$(grep -oE '/assets/_vinext_fonts/[A-Za-z0-9._/-]+\.woff2' <<<"$public_html" | sed -n '1p')"
[[ -n "$public_font_path" ]] || fail "Unable to discover the public font asset"
assert_public_mime "https://gridworks.cn${public_font_path}" font
assert_public_mime "${PUBLIC_STAGING_URL}/favicon.svg" svg
assert_public_mime "${PUBLIC_STAGING_URL}/og.png" png

log "Validating public login, Session lifecycle, roles, and cross-project isolation"
"${SSH[@]}" bash -s -- \
  "$REMOTE_DIR" "$REMOTE_ENV_FILE" "$PUBLIC_STAGING_URL" "$BASE_PATH" \
  "$COMPOSE_PROJECT" "$COMPOSE_FILE" "$COMMIT_SHA" "$APP_VERSION" \
  "$BUILD_TIME" "$DB_TOOLS_IMAGE_REF" "$DEPLOY_MARKER" \
  "$WORKER_CONTAINER_NAME" <<'REMOTE_PUBLIC_AUTH'
set -Eeuo pipefail
remote_dir="$1"
env_file="$2"
public_base_url="$3"
base_path="$4"
compose_project="$5"
compose_file="$6"
commit_sha="$7"
app_version="$8"
build_time="$9"
db_tools_image_ref="${10}"
deploy_marker="${11}"
worker_container_name="${12}"

[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$public_base_url" == "https://gridworks.cn/tool/projectai-staging" ]]
[[ "$base_path" == "/tool/projectai-staging" ]]
[[ "$compose_project" == "projectai-staging" ]]
[[ "$deploy_marker" == "$remote_dir/.staging-deploy-in-progress" ]]
[[ "$worker_container_name" == "project-ai-os-staging-worker" ]]
cd "$remote_dir"
sudo test -e "$deploy_marker"
compose_run=(
  sudo env
  "NEXT_PUBLIC_COMMIT_SHA=$commit_sha"
  "NEXT_PUBLIC_APP_VERSION=$app_version"
  "NEXT_PUBLIC_BUILD_TIME=$build_time"
  "STAGING_DB_TOOLS_IMAGE=$db_tools_image_ref"
  docker compose
  --env-file "$env_file"
  --project-name "$compose_project"
  --file "$compose_file"
  --profile operations
  run
  --rm
  --no-deps
  --pull never
  --interactive=false
  --no-TTY
)

"${compose_run[@]}" \
  --env "APP_BASE_URL=$public_base_url" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  --env "EXPECTED_COOKIE_PATH=$base_path" \
  --env "EXPECTED_COOKIE_PREFIX=projectai_staging" \
  --env "REQUIRE_SECURE_COOKIE=1" \
  projectai-migrate node scripts/verify-auth-boundaries.mjs

printf 'Verifying public Staging upload, download integrity, versioning, and lifecycle cleanup.\n'
"${compose_run[@]}" \
  --env "APP_BASE_URL=$public_base_url" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  projectai-file-smoke npm run storage:smoke

printf 'Verifying the public six-format document processing and search flow.\n'
"${compose_run[@]}" \
  --env "APP_BASE_URL=$public_base_url" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  projectai-document-smoke npm run documents:smoke

printf 'Rechecking PostgreSQL and MinIO consistency after public verification.\n'
"${compose_run[@]}" projectai-storage-ops npm run storage:verify

"${compose_run[@]}" projectai-migrate node --input-type=module -e '
    import pg from "pg";
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const result = await client.query(
        "select count(*)::int as count from document_ingestion_jobs where status = $1",
        ["running"],
      );
      if (result.rows[0]?.count !== 0) {
        throw new Error("Staging retains a running document Job");
      }
    } finally {
      await client.end();
    }
  '
unexpected_worker_temp="$(
  sudo docker exec "$worker_container_name" sh -ec \
    "find /tmp -maxdepth 1 -type f -name 'projectai-*' ! -name 'projectai-document-worker-heartbeat' -print"
)"
[[ -z "$unexpected_worker_temp" ]]
REMOTE_PUBLIC_AUTH

log "Confirming Production remains healthy"
for route in / /dashboard; do
  code="$(http_code "${PUBLIC_PRODUCTION_URL}${route}")"
  [[ "$code" == "200" ]] || fail "Production route ${route} returned ${code}"
done

[[ "$(get_production_state)" == "$PRODUCTION_STATE_BEFORE" ]] \
  || fail "Production changed before the Staging transaction could commit"
"${SSH[@]}" "sudo rm -f '$DEPLOY_MARKER'"

log "Staging deployment verified"
log "Environment=staging Version=${APP_VERSION} Commit=${COMMIT_SHA} BuildTime=${BUILD_TIME}"
log "Staging=${PUBLIC_STAGING_URL}/ Production=${PUBLIC_PRODUCTION_URL}/"
