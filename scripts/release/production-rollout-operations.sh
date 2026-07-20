#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${PROJECTAI_PRODUCTION_ROLLOUT_EXECUTION_ENABLED:-}" == "1" ]] || {
  printf 'PRODUCTION_APPLY_NOT_AUTHORIZED\n' >&2
  exit 78
}

readonly production_dir="/srv/projectai"
readonly compose_file="${production_dir}/docker-compose.production-rollout.yml"
readonly compose_project="projectai-production"
readonly local_url="http://127.0.0.1:3100/tool/projectai"
readonly public_url="https://gridworks.cn/tool/projectai"
action="${1:-}"
shift || true

[[ "$(pwd -P)" == "$production_dir" ]] || {
  printf 'Production rollout operations must run from %s.\n' "$production_dir" >&2
  exit 64
}
[[ -f "$compose_file" && ! -L "$compose_file" ]]

compose() {
  docker compose \
    --project-name "$compose_project" \
    --file "$compose_file" \
    "$@"
}

compose_ai() {
  docker compose \
    --project-name "$compose_project" \
    --file "$compose_file" \
    --file "${production_dir}/docker-compose.production-ai.yml" \
    "$@"
}

http_status() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 20 "$1"
}

rewrite_setting() {
  local file="$1"
  local key="$2"
  local value="$3"
  [[ "$file" == "$production_dir"/* ]]
  [[ -f "$file" && ! -L "$file" ]]
  local temporary
  temporary="$(mktemp "$production_dir/.rollout-setting.XXXXXX")"
  chmod 600 "$temporary"
  awk -F= -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $1 == key { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$file" > "$temporary"
  mv "$temporary" "$file"
}

case "$action" in
  validate-production-config)
    node "${production_dir}/scripts/release/production-config-validate.mjs" "$production_dir"
    ;;
  backup-config-metadata)
    backup_root="${production_dir}/backups/config"
    nginx_file="${PROJECTAI_PRODUCTION_NGINX_FILE:-/etc/nginx/sites-enabled/projectai.conf}"
    [[ -f "$nginx_file" && ! -L "$nginx_file" ]]
    install -d -m 0700 "$backup_root"
    stamp="$(date -u +'%Y%m%dT%H%M%SZ')"
    archive="${backup_root}/projectai-config-${stamp}.tar"
    tar --create --file "$archive" \
      --owner=0 --group=0 \
      -C / \
      "${compose_file#/}" \
      "${nginx_file#/}"
    chmod 600 "$archive"
    sha256sum "$archive" > "${archive}.sha256"
    chmod 600 "${archive}.sha256"
    ;;
  verify-disabled-application)
    [[ "$(http_status "$local_url/login")" == "200" ]]
    projects_status="$(http_status "$local_url/projects")"
    [[ "$projects_status" =~ ^(200|301|302|303|307|308)$ ]]
    health="$(curl --fail --silent --show-error --max-time 20 "$local_url/api/health")"
    [[ "$health" == *'"aiAssistantEnabled":false'* ]]
    [[ "$health" == *'"aiEmbeddingEnabled":false'* ]]
    [[ "$health" == *'"assistantRetrievalMode":"lexical"'* ]]
    [[ "$(http_status "$public_url/")" == "200" ]]
    ;;
  verify-assistant-lexical)
    health="$(curl --fail --silent --show-error --max-time 20 "$local_url/api/health")"
    [[ "$health" == *'"aiAssistantEnabled":true'* ]]
    [[ "$health" == *'"aiEmbeddingEnabled":false'* ]]
    [[ "$health" == *'"assistantRetrievalMode":"lexical"'* ]]
    compose_ai exec -T projectai-app npm run assistant:smoke
    ;;
  set-assistant-lexical)
    rewrite_setting "${production_dir}/.env.ai-production" AI_ASSISTANT_ENABLED true
    rewrite_setting "${production_dir}/.env.ai-production" AI_ASSISTANT_RETRIEVAL_MODE lexical
    rewrite_setting "${production_dir}/.env.embedding-production" AI_EMBEDDING_ENABLED false
    compose_ai up --detach --no-deps projectai-app
    ;;
  set-embedding-enabled)
    rewrite_setting "${production_dir}/.env.embedding-production" AI_EMBEDDING_ENABLED true
    compose_ai --profile embedding up --detach --no-deps projectai-embedding-worker
    ;;
  bounded-backfill)
    [[ "${1:-}" == "--limit=100" ]]
    compose --profile operations run --rm --no-deps \
      projectai-storage-operations npm run embeddings:backfill -- --apply --limit=100
    ;;
  verify-shadow-observation)
    compose --profile operations run --rm --no-deps \
      projectai-storage-operations npm run retrieval:shadow-report
    ;;
  verify-hybrid-observation)
    compose_ai exec -T projectai-app npm run assistant:smoke
    compose --profile operations run --rm --no-deps \
      projectai-storage-operations npm run retrieval:status
    ;;
  restore-old-app-image)
    [[ "${PROJECTAI_ROLLBACK_IMAGE:-}" =~ ^sha256:[0-9a-f]{64}$ ]]
    PRODUCTION_APP_IMAGE="$PROJECTAI_ROLLBACK_IMAGE" \
      compose up --detach --no-deps projectai-app
    [[ "$(http_status "$public_url/")" == "200" ]]
    ;;
  set-assistant-disabled)
    rewrite_setting "${production_dir}/.env.ai-production" AI_ASSISTANT_ENABLED false
    compose up --detach --no-deps projectai-app
    ;;
  set-embedding-disabled)
    rewrite_setting "${production_dir}/.env.embedding-production" AI_EMBEDDING_ENABLED false
    ;;
  set-retrieval-mode)
    mode="${1:-}"
    [[ "$mode" =~ ^(lexical|shadow|hybrid)$ ]]
    rewrite_setting "${production_dir}/.env.ai-production" AI_ASSISTANT_RETRIEVAL_MODE "$mode"
    compose_ai up --detach --no-deps projectai-app
    ;;
  release-lock)
    lock="${production_dir}/.production-rollout-lock"
    [[ -f "$lock" && ! -L "$lock" ]]
    rm -- "$lock"
    ;;
  *)
    printf 'Unsupported Production rollout internal operation.\n' >&2
    exit 64
    ;;
esac
