#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/srv/projectai}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-/tool/projectai}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3100${BASE_PATH}/dashboard}"
DEPLOY_FROM_GIT="${DEPLOY_FROM_GIT:-0}"
CHECK_NGINX="${CHECK_NGINX:-1}"
RELOAD_NGINX="${RELOAD_NGINX:-0}"

log() {
  printf '[projectai] %s\n' "$*"
}

fail() {
  printf '[projectai] ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -d "$PROJECT_DIR" ]] || fail "Project directory does not exist: $PROJECT_DIR"
cd "$PROJECT_DIR"
[[ -f package.json ]] || fail "package.json not found in $PROJECT_DIR"
[[ -f "$COMPOSE_FILE" ]] || fail "Compose file not found: $COMPOSE_FILE"
command -v docker >/dev/null 2>&1 || fail "Docker is required"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

if [[ "$DEPLOY_FROM_GIT" == "1" ]]; then
  [[ -d .git ]] || fail "DEPLOY_FROM_GIT=1 requires a Git checkout"
  [[ -z "$(git status --porcelain)" ]] || fail "Refusing to deploy a dirty checkout"
  log "Updating source with a fast-forward-only pull"
  git pull --ff-only
fi

log "Building production image for ${BASE_PATH}"
NEXT_PUBLIC_BASE_PATH="$BASE_PATH" docker compose -f "$COMPOSE_FILE" build --pull

log "Starting application"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

log "Waiting for application health"
healthy=0
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" == "1" ]] || {
  docker compose -f "$COMPOSE_FILE" logs --tail=200 >&2 || true
  fail "Health check failed: $HEALTH_URL"
}

if [[ "$CHECK_NGINX" == "1" ]]; then
  command -v nginx >/dev/null 2>&1 || fail "nginx is unavailable"
  log "Validating Nginx configuration"
  sudo nginx -t
fi

if [[ "$RELOAD_NGINX" == "1" ]]; then
  [[ "$CHECK_NGINX" == "1" ]] || sudo nginx -t
  log "Reloading Nginx after successful validation"
  sudo systemctl reload nginx
fi

log "Deployment healthy: $HEALTH_URL"
