#!/usr/bin/env bash
set -Eeuo pipefail

[[ "${PROJECTAI_PRODUCTION_ROLLOUT_EXECUTION_ENABLED:-}" == "1" ]] || {
  printf 'PRODUCTION_APPLY_NOT_AUTHORIZED\n' >&2
  exit 78
}

readonly production_dir="/srv/projectai"
readonly compose_file="${production_dir}/docker-compose.production-rollout.yml"
readonly compose_project="projectai-production"
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
  backup-config-metadata)
    backup_root="${production_dir}/backups/config"
    nginx_file="/etc/nginx/sites-enabled/projectai.conf"
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
  set-assistant-lexical)
    rewrite_setting "${production_dir}/.env.ai-production" AI_ASSISTANT_ENABLED true
    rewrite_setting "${production_dir}/.env.ai-production" AI_ASSISTANT_RETRIEVAL_MODE lexical
    rewrite_setting "${production_dir}/.env.embedding-production" AI_EMBEDDING_ENABLED false
    compose_ai up --detach --no-deps projectai-app
    ;;
  set-embedding-enabled)
    rewrite_setting "${production_dir}/.env.embedding-production" AI_EMBEDDING_ENABLED true
    compose_ai up --detach --no-deps projectai-app
    compose up --detach --no-deps projectai-document-worker
    compose_ai --profile embedding up --detach --no-deps projectai-embedding-worker
    ;;
  bounded-backfill)
    [[ "${1:-}" == "--limit=100" ]]
    backfill_result="$(compose --profile operations run --rm --no-deps \
      projectai-storage-operations npm run --silent embeddings:backfill -- --apply --limit=100)"
    BACKFILL_RESULT="$backfill_result" node -e '
      const value = JSON.parse(process.env.BACKFILL_RESULT);
      if (value.dryRun !== false || !Number.isSafeInteger(value.missingChunks) ||
          value.missingChunks < 0 || value.missingChunks > 100 ||
          !Number.isSafeInteger(value.enqueuedJobs) || value.enqueuedJobs < 0) process.exit(1);
      process.stdout.write(JSON.stringify({
        backfillChunkCount: value.missingChunks,
        enqueuedJobs: value.enqueuedJobs,
      }));
    '
    ;;
  restore-baseline-runtime)
    [[ "${PROJECTAI_TRUSTED_ROLLBACK_IMAGE:-}" =~ ^sha256:[0-9a-f]{64}$ ]]
    compose --profile embedding stop projectai-embedding-worker projectai-document-worker
    PRODUCTION_APP_IMAGE="$PROJECTAI_TRUSTED_ROLLBACK_IMAGE" \
      compose up --detach --no-deps projectai-app
    ;;
  set-assistant-disabled)
    rewrite_setting "${production_dir}/.env.ai-production" AI_ASSISTANT_ENABLED false
    compose up --detach --no-deps projectai-app
    ;;
  set-embedding-disabled)
    rewrite_setting "${production_dir}/.env.embedding-production" AI_EMBEDDING_ENABLED false
    compose_ai up --detach --no-deps projectai-app
    compose up --detach --no-deps projectai-document-worker
    ;;
  set-retrieval-mode)
    mode="${1:-}"
    [[ "$mode" =~ ^(lexical|shadow|hybrid)$ ]]
    rewrite_setting "${production_dir}/.env.ai-production" AI_ASSISTANT_RETRIEVAL_MODE "$mode"
    compose_ai up --detach --no-deps projectai-app
    ;;
  retain-lock-for-verification)
    lock="${production_dir}/.production-rollout-lock"
    [[ -f "$lock" && ! -L "$lock" ]]
    [[ "$(stat -c '%a' "$lock")" == "600" ]]
    ;;
  *)
    printf 'Unsupported Production rollout internal operation.\n' >&2
    exit 64
    ;;
esac
