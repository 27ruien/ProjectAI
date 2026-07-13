#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_BRANCH="${EXPECTED_BRANCH:-agent/mvp-validation-foundation}"
REMOTE_HOST="${REMOTE_HOST:-gridworks.cn}"
REMOTE_DIR="${REMOTE_DIR:-/srv/projectai-staging}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-projectai-staging}"
COMPOSE_FILE="docker-compose.staging.yml"
CONTAINER_NAME="project-ai-os-staging"
BASE_PATH="/tool/projectai-staging"
APP_VERSION="${NEXT_PUBLIC_APP_VERSION:-0.2.0-staging}"
PUBLIC_STAGING_URL="${PUBLIC_STAGING_URL:-https://gridworks.cn/tool/projectai-staging}"
PUBLIC_PRODUCTION_URL="${PUBLIC_PRODUCTION_URL:-https://gridworks.cn/tool/projectai}"
PUBLIC_VALIDATION="${PUBLIC_VALIDATION:-1}"

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
    | awk 'BEGIN { IGNORECASE=1 } /^content-type:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }'
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

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "Run this script from a Git checkout"
cd "$ROOT_DIR"

[[ "$REMOTE_DIR" == "/srv/projectai-staging" ]] || fail "REMOTE_DIR must remain isolated at /srv/projectai-staging"
[[ "$APP_VERSION" =~ ^[0-9A-Za-z._-]+$ ]] || fail "NEXT_PUBLIC_APP_VERSION contains unsupported characters"
[[ -f "$COMPOSE_FILE" ]] || fail "Missing ${COMPOSE_FILE}"

CURRENT_BRANCH="$(git branch --show-current)"
[[ "$CURRENT_BRANCH" == "$EXPECTED_BRANCH" ]] || fail "Expected branch ${EXPECTED_BRANCH}, found ${CURRENT_BRANCH:-detached HEAD}"
[[ -z "$(git status --porcelain)" ]] || fail "Refusing to deploy a dirty working tree"
git diff --check --cached

COMMIT_SHA="$(git rev-parse HEAD)"
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "Unable to determine a full Commit SHA"
SHORT_SHA="${COMMIT_SHA:0:8}"
BUILD_TIME="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
DEPLOY_STAMP="$(date -u +'%Y%m%d%H%M%S')"
export NEXT_PUBLIC_APP_VERSION="$APP_VERSION"
export NEXT_PUBLIC_COMMIT_SHA="$COMMIT_SHA"
export NEXT_PUBLIC_BUILD_TIME="$BUILD_TIME"

SSH=(ssh -o BatchMode=yes "$REMOTE_HOST")

log "Verifying required SSH identity and passwordless sudo"
"${SSH[@]}" 'echo connected && whoami && hostname && sudo -n true && echo sudo-ok'

log "Checking isolated remote prerequisites"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$CONTAINER_NAME" <<'REMOTE_PREFLIGHT'
set -Eeuo pipefail
remote_dir="$1"
container_name="$2"
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

REMOTE_PREFLIGHT

PRODUCTION_STATE_BEFORE="$("${SSH[@]}" "sudo docker inspect --format '{{.Id}} {{.State.Running}} {{.RestartCount}}' project-ai-os")" \
  || fail "Production container project-ai-os must be running before staging deployment"
[[ "$PRODUCTION_STATE_BEFORE" == *" true "* ]] || fail "Production container is not running before staging deployment"

log "Syncing Commit ${SHORT_SHA} to ${REMOTE_HOST}:${REMOTE_DIR}"
"${SSH[@]}" bash -s -- "$REMOTE_DIR" "$DEPLOY_STAMP" <<'REMOTE_RELEASE'
set -Eeuo pipefail
remote_dir="$1"
deploy_stamp="$2"
if sudo test -f "$remote_dir/package.json"; then
  backup="${remote_dir}.backup.${deploy_stamp}"
  sudo test ! -e "$backup"
  sudo mv "$remote_dir" "$backup"
  printf 'Staging source backup: %s\n' "$backup"
elif sudo test -d "$remote_dir"; then
  sudo rmdir "$remote_dir"
fi
sudo install -d -m 0755 -o "$(id -un)" -g "$(id -gn)" "$remote_dir"
REMOTE_RELEASE

rsync --archive --compress --delete \
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
  --exclude '/.env' \
  --exclude '/.env.*' \
  --exclude '*.log' \
  --rsh='ssh -o BatchMode=yes' \
  ./ "${REMOTE_HOST}:${REMOTE_DIR}/"

log "Building and starting the isolated Staging container"
"${SSH[@]}" bash -s -- \
  "$REMOTE_DIR" "$COMPOSE_PROJECT" "$COMPOSE_FILE" "$CONTAINER_NAME" \
  "$BASE_PATH" "$COMMIT_SHA" "$APP_VERSION" "$BUILD_TIME" <<'REMOTE_DEPLOY'
set -Eeuo pipefail
remote_dir="$1"
compose_project="$2"
compose_file="$3"
container_name="$4"
base_path="$5"
commit_sha="$6"
app_version="$7"
build_time="$8"
origin='http://127.0.0.1:3101'

cd "$remote_dir"
export NEXT_PUBLIC_COMMIT_SHA="$commit_sha"
export NEXT_PUBLIC_APP_VERSION="$app_version"
export NEXT_PUBLIC_BUILD_TIME="$build_time"

compose=(
  sudo env
  "NEXT_PUBLIC_COMMIT_SHA=$commit_sha"
  "NEXT_PUBLIC_APP_VERSION=$app_version"
  "NEXT_PUBLIC_BUILD_TIME=$build_time"
  docker compose
  --project-name "$compose_project"
  --file "$compose_file"
)
trap '${compose[@]} logs --tail=200 >&2 || true' ERR

"${compose[@]}" build --pull
"${compose[@]}" up --detach --remove-orphans

ready=0
container_health="starting"
for _ in $(seq 1 60); do
  container_health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name")"
  if [[ "$container_health" == "unhealthy" || "$container_health" == "exited" || "$container_health" == "dead" ]]; then
    printf 'Staging container entered terminal state: %s\n' "$container_health" >&2
    exit 1
  fi
  if [[ "$container_health" == "healthy" ]] \
    && curl --fail --silent --max-time 5 "${origin}${base_path}/dashboard" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]] || {
  printf 'Staging readiness timed out; final container health: %s\n' "$container_health" >&2
  exit 1
}

for route in / /dashboard /projects /reviews /settings/ai-models; do
  curl --fail --silent --show-error --max-time 10 "${origin}${base_path}${route}" >/dev/null
done

html="$(curl --fail --silent --show-error --max-time 10 "${origin}${base_path}/dashboard")"
grep -q 'STAGING' <<<"$html"
grep -q "${commit_sha:0:8}" <<<"$html"
grep -q 'noindex' <<<"$html"

css_path="$(grep -oE "${base_path}/assets/[A-Za-z0-9._/-]+\\.css" <<<"$html" | sed -n '1p')"
js_path="$(grep -oE "${base_path}/assets/[A-Za-z0-9._/-]+\\.js" <<<"$html" | sed -n '1p')"
[[ -n "$css_path" && -n "$js_path" ]]

content_type() {
  curl --fail --silent --show-error --head --max-time 10 "$1" \
    | tr -d '\r' \
    | awk 'BEGIN { IGNORECASE=1 } /^content-type:/ { sub(/^[^:]+:[[:space:]]*/, ""); print; exit }'
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

PRODUCTION_STATE_AFTER="$("${SSH[@]}" "sudo docker inspect --format '{{.Id}} {{.State.Running}} {{.RestartCount}}' project-ai-os")"
[[ "$PRODUCTION_STATE_AFTER" == "$PRODUCTION_STATE_BEFORE" ]] \
  || fail "Production container identity or restart state changed during Staging deployment"

if [[ "$PUBLIC_VALIDATION" != "1" ]]; then
  log "Public Staging validation skipped for initial upstream-only rollout"
  log "Staging upstream verified; configure Nginx, then rerun with PUBLIC_VALIDATION=1"
  exit 0
fi

log "Validating public Staging redirect, deep routes, noindex, and assets"
redirect_code="$(http_code "$PUBLIC_STAGING_URL")"
[[ "$redirect_code" == "308" || "$redirect_code" == "301" ]] || fail "Unexpected Staging redirect status: ${redirect_code}"

for route in / /dashboard /projects /reviews /settings/ai-models; do
  code="$(http_code "${PUBLIC_STAGING_URL}${route}")"
  [[ "$code" == "200" ]] || fail "Staging route ${route} returned ${code}"
done

staging_headers="$(curl --fail --silent --show-error --head --max-time 20 "${PUBLIC_STAGING_URL}/dashboard" | tr -d '\r')"
grep -qi '^x-robots-tag:.*noindex.*nofollow' <<<"$staging_headers" \
  || fail "Staging response is missing X-Robots-Tag noindex, nofollow"

public_html="$(curl --fail --silent --show-error --max-time 20 "${PUBLIC_STAGING_URL}/dashboard")"
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

log "Confirming Production remains healthy"
for route in / /dashboard; do
  code="$(http_code "${PUBLIC_PRODUCTION_URL}${route}")"
  [[ "$code" == "200" ]] || fail "Production route ${route} returned ${code}"
done

log "Staging deployment verified"
log "Environment=staging Version=${APP_VERSION} Commit=${COMMIT_SHA} BuildTime=${BUILD_TIME}"
log "Staging=${PUBLIC_STAGING_URL}/ Production=${PUBLIC_PRODUCTION_URL}/"
