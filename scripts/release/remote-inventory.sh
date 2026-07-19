#!/usr/bin/env bash
set -Eeuo pipefail

environment="${1:-}"
case "$environment" in
  production|staging) ;;
  *) printf 'Unsupported inventory environment.\n' >&2; exit 64 ;;
esac

emit() {
  local key="$1"
  local value="${2:-}"
  value="${value//$'\n'/ }"
  value="${value//$'\t'/ }"
  printf '%s\t%s\n' "$key" "$value"
}

container_exists() {
  sudo -n docker container inspect "$1" >/dev/null 2>&1
}

mount_present() {
  local container="$1"
  local pattern="$2"
  sudo -n docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$container" \
    | awk -v pattern="$pattern" '
        BEGIN { found = 0 }
        tolower($0) ~ pattern { found = 1 }
        END { if (found) print "true"; else print "false" }
      '
}

container_field() {
  sudo -n docker inspect --format "$2" "$1"
}

nginx_hash() {
  sudo -n sh -c '
    find /etc/nginx -type f \( -name "*.conf" -o -path "/etc/nginx/sites-enabled/*" \) -print0 \
      | sort -z \
      | xargs -0 sha256sum \
      | sha256sum \
      | cut -d" " -f1
  '
}

latest_backup() {
  local root="$1"
  if ! sudo -n test -d "$root"; then
    printf 'absent\t0\t\n'
    return
  fi
  local latest
  latest="$(sudo -n find "$root" -maxdepth 1 -type f -printf '%T@|%s|%TY-%Tm-%TdT%TH:%TM:%TSZ\n' \
    | sort -nr | head -1 || true)"
  if [[ -z "$latest" ]]; then
    printf 'empty\t0\t\n'
    return
  fi
  IFS='|' read -r _ size timestamp <<<"$latest"
  printf 'present\t%s\t%s\n' "$size" "$timestamp"
}

disk_line="$(df -B1 / | awk 'NR==2 {print $2 "|" $3 "|" $4 "|" $5}')"
inode_line="$(df -i / | awk 'NR==2 {print $2 "|" $3 "|" $4 "|" $5}')"
IFS='|' read -r disk_total disk_used disk_available disk_usage <<<"$disk_line"
IFS='|' read -r inode_total inode_used inode_available inode_usage <<<"$inode_line"

emit schemaVersion 1
emit environment "$environment"
emit capturedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
emit host "$(hostname)"
emit capacity.totalBytes "$disk_total"
emit capacity.usedBytes "$disk_used"
emit capacity.availableBytes "$disk_available"
emit capacity.filesystemUsagePercent "${disk_usage%%%}"
emit capacity.inodeTotal "$inode_total"
emit capacity.inodeUsed "$inode_used"
emit capacity.inodeAvailable "$inode_available"
emit capacity.inodeUsagePercent "${inode_usage%%%}"
emit capacity.dockerImages "$(sudo -n docker system df --format '{{if eq .Type "Images"}}{{.Size}}{{end}}' | sed -n '/./p' | head -1)"
emit capacity.dockerVolumes "$(sudo -n docker system df --format '{{if eq .Type "Local Volumes"}}{{.Size}}{{end}}' | sed -n '/./p' | head -1)"
emit capacity.dockerBuildCache "$(sudo -n docker system df --format '{{if eq .Type "Build Cache"}}{{.Size}}{{end}}' | sed -n '/./p' | head -1)"
emit configuration.nginxHash "sha256:$(nginx_hash)"
if sudo -n nginx -t >/dev/null 2>&1; then
  emit checks.nginxConfigValid true
else
  emit checks.nginxConfigValid false
fi

if [[ "$environment" == "production" ]]; then
  app=project-ai-os
  compose_file=/srv/projectai/docker-compose.prod.yml
  base_url=http://127.0.0.1:3100/tool/projectai
  public_url=https://gridworks.cn/tool/projectai/
  backup_root=/srv/projectai/backups
  postgres=project-ai-os-postgres
  minio=project-ai-os-minio
  document_worker=project-ai-os-worker
  embedding_worker=project-ai-os-embedding-worker
else
  app=project-ai-os-staging
  compose_file=/srv/projectai-staging/docker-compose.staging.yml
  base_url=http://127.0.0.1:3101/tool/projectai-staging
  public_url=https://gridworks.cn/tool/projectai-staging/
  backup_root=/srv/projectai-staging/backups
  postgres=project-ai-os-staging-postgres
  minio=project-ai-os-staging-minio
  document_worker=project-ai-os-staging-worker
  embedding_worker=project-ai-os-staging-embedding-worker
fi

emit app.containerId "$(container_field "$app" '{{.Id}}')"
app_image="$(container_field "$app" '{{.Image}}')"
emit app.imageDigest "$app_image"
emit app.createdAt "$(container_field "$app" '{{.Created}}')"
emit app.startedAt "$(container_field "$app" '{{.State.StartedAt}}')"
emit app.restartCount "$(container_field "$app" '{{.RestartCount}}')"
emit app.status "$(container_field "$app" '{{.State.Status}}')"
emit app.health "$(container_field "$app" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
emit app.composeProject "$(container_field "$app" '{{index .Config.Labels "com.docker.compose.project"}}')"
app_commit="$(sudo -n docker exec "$app" sh -c 'printf "%s" "$NEXT_PUBLIC_COMMIT_SHA"' 2>/dev/null || true)"
if [[ "$app_commit" =~ ^[0-9a-f]{40}$ ]]; then
  emit app.commitSha "$app_commit"
else
  emit app.commitSha null
fi
emit app.imageSizeBytes "$(sudo -n docker image inspect --format '{{.Size}}' "$app_image")"
emit app.publicHttpStatus "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$public_url")"
emit app.localHttpStatus "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$base_url/")"

emit configuration.composeHash "sha256:$(sudo -n sha256sum "$compose_file" | cut -d' ' -f1)"
if [[ "$environment" == "production" ]]; then
  if sudo -n docker compose -f "$compose_file" config --quiet >/dev/null 2>&1; then
    emit checks.composeConfigValid true
  else
    emit checks.composeConfigValid false
  fi
else
  # The deployed Staging file requires protected env files. Parsing remains
  # quiet and never serializes the resolved configuration.
  current_image="project-ai-os-staging:$app_commit"
  if sudo -n env \
    NEXT_PUBLIC_COMMIT_SHA="$app_commit" \
    NEXT_PUBLIC_APP_VERSION=0.8.0-staging \
    NEXT_PUBLIC_BUILD_TIME=inventory \
    STAGING_APP_IMAGE="$current_image" \
    STAGING_WORKER_IMAGE="$current_image" \
    STAGING_EMBEDDING_WORKER_IMAGE="$current_image" \
    STAGING_DB_TOOLS_IMAGE="$current_image" \
    STAGING_POSTGRES_IMAGE=pgvector/pgvector:0.8.1-pg17@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21 \
    STAGING_MINIO_IMAGE=quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z \
    STAGING_MINIO_CLIENT_IMAGE=quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z \
    docker compose \
      --env-file /srv/projectai-staging/.env.auth-staging \
      --env-file /srv/projectai-staging/.env.embedding \
      --project-name projectai-staging \
      --file "$compose_file" \
      --profile operations \
      config --quiet >/dev/null 2>&1; then
    emit checks.composeConfigValid true
  else
    emit checks.composeConfigValid false
  fi
fi

if [[ "$environment" == "staging" ]]; then
  health="$(curl -fsS --max-time 15 "$base_url/api/health")"
  case "$health" in *'"aiAssistantEnabled":true'*) assistant=true ;; *) assistant=false ;; esac
  case "$health" in *'"aiEmbeddingEnabled":true'*) embedding=true ;; *) embedding=false ;; esac
  case "$health" in *'"assistantRetrievalMode":"hybrid"'*) mode=hybrid ;; *'"assistantRetrievalMode":"shadow"'*) mode=shadow ;; *) mode=lexical ;; esac
  case "$health" in *'"queryEmbeddingConfigured":true'*) query_configured=true ;; *) query_configured=false ;; esac
else
  flags="$(sudo -n docker exec "$app" sh -c 'printf "%s|%s|%s" "$AI_ASSISTANT_ENABLED" "$AI_EMBEDDING_ENABLED" "$AI_ASSISTANT_RETRIEVAL_MODE"')"
  IFS='|' read -r assistant_raw embedding_raw mode_raw <<<"$flags"
  [[ "$assistant_raw" == "true" ]] && assistant=true || assistant=false
  [[ "$embedding_raw" == "true" ]] && embedding=true || embedding=false
  case "$mode_raw" in lexical|shadow|hybrid) mode="$mode_raw" ;; *) mode=lexical ;; esac
  query_configured=false
fi
emit features.aiAssistantEnabled "$assistant"
emit features.aiEmbeddingEnabled "$embedding"
emit features.retrievalMode "$mode"
emit features.queryEmbeddingConfigured "$query_configured"
emit features.qwenSecretMount "$(mount_present "$app" 'qwen_api_key')"
profile_values="$(sudo -n docker exec "$app" sh -c 'printf "%s|%s|%s|%s|%s" "$AI_HYBRID_RETRIEVAL_PROFILE_ID" "$AI_EMBEDDING_PROFILE_ID" "$AI_HYBRID_QUERY_EMBEDDING_TIMEOUT_MS" "$AI_HYBRID_VECTOR_SQL_TIMEOUT_MS" "$AI_HYBRID_QUERY_EMBEDDING_DAILY_TOKEN_LIMIT"' 2>/dev/null || true)"
IFS='|' read -r retrieval_profile embedding_profile query_timeout vector_timeout daily_budget <<<"$profile_values"
emit features.retrievalProfileId "${retrieval_profile:-null}"
emit features.embeddingProfileId "${embedding_profile:-null}"
emit features.hybridQueryEmbeddingTimeoutMs "${query_timeout:-null}"
emit features.hybridVectorSqlTimeoutMs "${vector_timeout:-null}"
emit features.hybridDailyQueryTokenLimit "${daily_budget:-null}"

if container_exists "$postgres"; then
  emit database.present true
  emit database.containerId "$(container_field "$postgres" '{{.Id}}')"
  database_image="$(container_field "$postgres" '{{.Image}}')"
  emit database.imageDigest "$database_image"
  emit database.health "$(container_field "$postgres" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  database_rows="$(sudo -n docker exec -i "$postgres" sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
select current_setting('server_version');
select pg_database_size(current_database());
select coalesce((select extversion from pg_extension where extname='vector'),'absent');
select case when to_regclass('drizzle.__drizzle_migrations') is null then 'none' else (select count(*)::text from drizzle.__drizzle_migrations) end;
SQL
)"
  mapfile -t database_values <<<"$database_rows"
  emit database.version "${database_values[0]:-unknown}"
  emit database.sizeBytes "${database_values[1]:-0}"
  emit database.pgvectorVersion "${database_values[2]:-absent}"
  emit database.migrationCount "${database_values[3]:-none}"
  if [[ "$environment" == "staging" ]]; then
    active="$(sudo -n docker exec -i "$postgres" sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
select
  (select count(*) from document_ingestion_jobs where status in ('pending','running')) || '|' ||
  (select count(*) from document_embedding_jobs where status in ('pending','running')) || '|' ||
  (select count(*) from document_embedding_batches where status in ('reserved','calling')) || '|' ||
  (select count(*) from document_embedding_provider_calls where status in ('reserved','calling')) || '|' ||
  (select count(*) from ai_retrieval_runs where status='running') || '|' ||
  (select count(*) from ai_retrieval_query_embedding_calls where status in ('reserved','calling')) || '|' ||
  (select count(*) from ai_executions where status in ('reserved','retrieving','calling_provider','validating'));
SQL
)"
    IFS='|' read -r document_jobs embedding_jobs embedding_batches embedding_calls retrieval_runs query_calls executions <<<"$active"
  fi
else
  emit database.present false
  emit database.containerId null
  emit database.imageDigest null
  emit database.health absent
  emit database.version absent
  emit database.sizeBytes 0
  emit database.pgvectorVersion absent
  emit database.migrationCount none
fi

if container_exists "$minio"; then
  emit objectStorage.present true
  emit objectStorage.containerId "$(container_field "$minio" '{{.Id}}')"
  emit objectStorage.imageDigest "$(container_field "$minio" '{{.Image}}')"
  emit objectStorage.health "$(container_field "$minio" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  emit objectStorage.objectCount "$(sudo -n docker exec "$minio" sh -c 'find /data/projectai-staging-files -type f -name xl.meta 2>/dev/null | wc -l')"
  object_bytes="$(sudo -n docker exec "$minio" sh -c 'du -sb /data/projectai-staging-files 2>/dev/null' | cut -f1 || true)"
  emit objectStorage.totalBytes "${object_bytes:-0}"
  emit objectStorage.bucketCount 1
else
  emit objectStorage.present false
  emit objectStorage.containerId null
  emit objectStorage.imageDigest null
  emit objectStorage.health absent
  emit objectStorage.objectCount 0
  emit objectStorage.totalBytes 0
  emit objectStorage.bucketCount 0
fi

if container_exists "$document_worker"; then
  emit services.documentWorker true
  emit services.documentWorkerHealth "$(container_field "$document_worker" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  emit services.documentWorkerRestartCount "$(container_field "$document_worker" '{{.RestartCount}}')"
else
  emit services.documentWorker false
  emit services.documentWorkerHealth absent
  emit services.documentWorkerRestartCount 0
fi
if container_exists "$embedding_worker"; then
  emit services.embeddingWorker true
  emit services.embeddingWorkerHealth "$(container_field "$embedding_worker" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  emit services.embeddingWorkerRestartCount "$(container_field "$embedding_worker" '{{.RestartCount}}')"
else
  emit services.embeddingWorker false
  emit services.embeddingWorkerHealth absent
  emit services.embeddingWorkerRestartCount 0
fi

emit active.documentJobs "${document_jobs:-0}"
emit active.embeddingJobs "${embedding_jobs:-0}"
emit active.embeddingBatches "${embedding_batches:-0}"
emit active.embeddingProviderCalls "${embedding_calls:-0}"
emit active.retrievalRuns "${retrieval_runs:-0}"
emit active.queryEmbeddingCalls "${query_calls:-0}"
emit active.aiExecutions "${executions:-0}"

IFS=$'\t' read -r backup_state backup_size backup_time <<<"$(latest_backup "$backup_root")"
emit backup.directory "$backup_root"
emit backup.state "$backup_state"
emit backup.latestSizeBytes "$backup_size"
emit backup.latestCompletedAt "${backup_time:-null}"

if [[ "$environment" == "production" ]]; then
  deployment_lock=/srv/projectai/.production-deploy-lock
else
  deployment_lock=/srv/projectai-staging/.staging-deploy-lock
fi
if sudo -n test -e "$deployment_lock"; then
  emit locks.deployment true
else
  emit locks.deployment false
fi
emit locks.migration false
