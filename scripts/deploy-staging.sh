#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXPECTED_BRANCH="agent/auth-project-isolation"
REMOTE_HOST="${REMOTE_HOST:-gridworks.cn}"
REMOTE_DIR="${REMOTE_DIR:-/srv/projectai-staging}"
readonly COMPOSE_PROJECT="projectai-staging"
COMPOSE_FILE="docker-compose.staging.yml"
CONTAINER_NAME="project-ai-os-staging"
DB_CONTAINER_NAME="project-ai-os-staging-postgres"
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
  "$REMOTE_DIR" "$REMOTE_ENV_FILE" "$CONTAINER_NAME" "$DB_CONTAINER_NAME" \
  "$COMPOSE_PROJECT" "$DEPLOY_MARKER" "$DEPLOY_LOCK_DIR" "$DEPLOY_ID" <<'REMOTE_PREFLIGHT'
set -Eeuo pipefail
remote_dir="$1"
env_file="$2"
container_name="$3"
db_container_name="$4"
compose_project="$5"
deploy_marker="$6"
deploy_lock="$7"
deploy_id="$8"
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
  $1 == "STAGING_DB_TOOLS_IMAGE" ||
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

PREVIOUS_STAGING_STATE="$("${SSH[@]}" bash -s -- "$CONTAINER_NAME" "$BASE_PATH" <<'REMOTE_IMAGE'
set -Eeuo pipefail
container_name="$1"
base_path="$2"
image=""
health_path="/login"
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
else
  sudo docker info >/dev/null
fi
printf '%s|%s\n' "$image" "$health_path"
REMOTE_IMAGE
)" || fail "Unable to inspect the previous Staging image safely"
IFS='|' read -r PREVIOUS_STAGING_IMAGE PREVIOUS_STAGING_HEALTH_PATH <<<"$PREVIOUS_STAGING_STATE"
[[ -z "$PREVIOUS_STAGING_IMAGE" || "$PREVIOUS_STAGING_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] \
  || fail "Unable to capture the immutable previous Staging image ID"
[[ "$PREVIOUS_STAGING_HEALTH_PATH" == "/login" || "$PREVIOUS_STAGING_HEALTH_PATH" == "/api/health" ]] \
  || fail "Unable to determine the previous Staging health contract"

rollback_staging_if_marked() {
  "${SSH[@]}" bash -s -- \
    "$REMOTE_DIR" "$REMOTE_ENV_FILE" "$COMPOSE_PROJECT" "$COMPOSE_FILE" \
    "$CONTAINER_NAME" "$DB_CONTAINER_NAME" "$BASE_PATH" "$DEPLOY_MARKER" \
    "$PREVIOUS_STAGING_IMAGE" "$PREVIOUS_STAGING_HEALTH_PATH" \
    "$COMMIT_SHA" "$APP_VERSION" "$BUILD_TIME" <<'REMOTE_ROLLBACK'
set -Eeuo pipefail
remote_dir="$1"
env_file="$2"
compose_project="$3"
compose_file="$4"
container_name="$5"
db_container_name="$6"
base_path="$7"
deploy_marker="$8"
previous_image="$9"
previous_health_path="${10}"
commit_sha="${11}"
app_version="${12}"
build_time="${13}"

[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$compose_project" == "projectai-staging" ]]
[[ "$previous_health_path" == "/login" || "$previous_health_path" == "/api/health" ]]
sudo test -e "$deploy_marker" || exit 0
cd "$remote_dir"

rollback_health_path="$previous_health_path"
previous_requires_database="0"
[[ "$previous_health_path" != "/api/health" ]] || previous_requires_database="1"

compose=(
  sudo env
  "NEXT_PUBLIC_COMMIT_SHA=$commit_sha"
  "NEXT_PUBLIC_APP_VERSION=$app_version"
  "NEXT_PUBLIC_BUILD_TIME=$build_time"
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
    "NEXT_PUBLIC_COMMIT_SHA=$commit_sha"
    "NEXT_PUBLIC_APP_VERSION=$app_version"
    "NEXT_PUBLIC_BUILD_TIME=$build_time"
    "STAGING_APP_IMAGE=$previous_image"
    "STAGING_HEALTHCHECK_PATH=$rollback_health_path"
    docker compose
    --env-file "$env_file"
    --project-name "$compose_project"
    --file "$compose_file"
  )
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
else
  printf 'No previous Staging image exists; stopping the failed application and preserving PostgreSQL.\n' >&2
  "${compose[@]}" stop projectai-staging
  failed_app_running="$(sudo docker inspect --format '{{.State.Running}}' "$container_name" 2>/dev/null || printf 'false')"
  [[ "$failed_app_running" != "true" ]]
fi

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
  "$CONTAINER_NAME" "$DB_CONTAINER_NAME" "$BASE_PATH" "$COMMIT_SHA" \
  "$APP_VERSION" "$BUILD_TIME" "$DEPLOY_MARKER" "$BACKUP_RETENTION" \
  "$APP_IMAGE_REF" "$APP_IMAGE_ID" "$DB_TOOLS_IMAGE_REF" "$DB_TOOLS_IMAGE_ID" <<'REMOTE_DEPLOY'
set -Eeuo pipefail
remote_dir="$1"
env_file="$2"
compose_project="$3"
compose_file="$4"
container_name="$5"
db_container_name="$6"
base_path="$7"
commit_sha="$8"
app_version="$9"
build_time="${10}"
deploy_marker="${11}"
backup_retention="${12}"
app_image_ref="${13}"
app_image_id="${14}"
db_tools_image_ref="${15}"
db_tools_image_id="${16}"
origin='http://127.0.0.1:3101'

cd "$remote_dir"
[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$compose_project" == "projectai-staging" ]]
[[ "$deploy_marker" == "$remote_dir/.staging-deploy-in-progress" ]]
[[ "$backup_retention" =~ ^[1-9][0-9]*$ ]]
[[ "$app_image_ref" == "project-ai-os-staging:${commit_sha}" ]]
[[ "$db_tools_image_ref" == "project-ai-os-staging-db-tools:${commit_sha}" ]]
[[ "$app_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$db_tools_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
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
  "STAGING_DB_TOOLS_IMAGE=$db_tools_image_ref"
  docker compose
  --env-file "$env_file"
  --project-name "$compose_project"
  --file "$compose_file"
)
trap '${compose[@]} ps >&2 || true' ERR

operations=(
  sudo docker run
  --rm
  --network projectai-staging-internal
  --cpus 1
  --memory 512m
  --pids-limit 256
  --log-driver json-file
  --log-opt max-size=10m
  --log-opt max-file=2
  --env-file "$env_file"
  --env NODE_ENV=production
)

if sudo docker inspect "$db_container_name" >/dev/null 2>&1; then
  existing_db_mount="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}|{{.Name}}|{{.Destination}}{{end}}{{end}}' "$db_container_name")"
  [[ "$existing_db_mount" == "volume|projectai-staging-postgres|/var/lib/postgresql/data" ]] || {
    printf 'Refusing to recreate PostgreSQL with an unexpected data mount: %s\n' "${existing_db_mount:-missing}" >&2
    exit 1
  }
fi
"${compose[@]}" up --detach --no-build projectai-postgres

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
"${operations[@]}" "$db_tools_image_id" node --input-type=module -e '
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
"${operations[@]}" "$db_tools_image_id" npm run db:migrate
printf 'Applying idempotent Staging seed data.\n'
"${operations[@]}" "$db_tools_image_id" npm run db:seed

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

[[ "$(sudo docker inspect --format '{{.Image}}' "$container_name")" == "$app_image_id" ]]
[[ "$(sudo docker inspect --format '{{.State.Health.Status}}' "$db_container_name")" == "healthy" ]]
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
"${operations[@]}" \
  --env "APP_BASE_URL=http://projectai-staging:3000${base_path}" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  --env "EXPECTED_COOKIE_PATH=${base_path}" \
  --env "EXPECTED_COOKIE_PREFIX=projectai_staging" \
  --env "REQUIRE_SECURE_COOKIE=1" \
  "$db_tools_image_id" node scripts/verify-auth-boundaries.mjs

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

log "Validating public Staging login, protected-route redirects, noindex, and assets"
redirect_code="$(http_code "$PUBLIC_STAGING_URL")"
[[ "$redirect_code" == "308" || "$redirect_code" == "301" ]] || fail "Unexpected Staging redirect status: ${redirect_code}"

login_code="$(http_code "${PUBLIC_STAGING_URL}/login")"
[[ "$login_code" == "200" ]] || fail "Staging login returned ${login_code}"

for route in /dashboard /projects /projects/project-002/overview /reviews /settings/ai-models; do
  code="$(http_code "${PUBLIC_STAGING_URL}${route}")"
  [[ "$code" =~ ^30[2378]$ ]] || fail "Anonymous Staging route ${route} returned ${code}, expected a login redirect"
  location="$(curl --silent --show-error --head --max-time 20 "${PUBLIC_STAGING_URL}${route}" \
    | tr -d '\r' \
    | awk 'tolower($0) ~ /^location:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }')"
  [[ "$location" == *"${BASE_PATH}/login"* ]] || fail "Staging route ${route} did not redirect to the scoped login page"
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
  "$DB_TOOLS_IMAGE_ID" "$DEPLOY_MARKER" <<'REMOTE_PUBLIC_AUTH'
set -Eeuo pipefail
remote_dir="$1"
env_file="$2"
public_base_url="$3"
base_path="$4"
db_tools_image_id="$5"
deploy_marker="$6"

[[ "$remote_dir" == "/srv/projectai-staging" ]]
[[ "$public_base_url" == "https://gridworks.cn/tool/projectai-staging" ]]
[[ "$base_path" == "/tool/projectai-staging" ]]
[[ "$deploy_marker" == "$remote_dir/.staging-deploy-in-progress" ]]
[[ "$db_tools_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
sudo test -e "$deploy_marker"
[[ "$(sudo docker image inspect --format '{{.Id}}' "$db_tools_image_id")" == "$db_tools_image_id" ]]

operations=(
  sudo docker run
  --rm
  --network projectai-staging-internal
  --cpus 1
  --memory 512m
  --pids-limit 256
  --log-driver json-file
  --log-opt max-size=10m
  --log-opt max-file=2
  --env-file "$env_file"
  --env NODE_ENV=production
)

"${operations[@]}" \
  --env "APP_BASE_URL=$public_base_url" \
  --env "AUTH_REQUEST_ORIGIN=https://gridworks.cn" \
  --env "EXPECTED_COOKIE_PATH=$base_path" \
  --env "EXPECTED_COOKIE_PREFIX=projectai_staging" \
  --env "REQUIRE_SECURE_COOKIE=1" \
  "$db_tools_image_id" node scripts/verify-auth-boundaries.mjs
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
