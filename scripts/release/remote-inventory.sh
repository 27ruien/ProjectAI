#!/usr/bin/env bash
set -Eeuo pipefail

environment="${1:-}"
expected_migration_lock_file="${2:-}"
migration_advisory_key="${3:-}"
case "$environment" in
  production|staging) ;;
  *) printf 'Unsupported inventory environment.\n' >&2; exit 64 ;;
esac
[[ "$expected_migration_lock_file" =~ ^/srv/projectai(-staging)?/\.[a-z-]+$ ]] || {
  printf 'Invalid migration lock file contract.\n' >&2
  exit 64
}
[[ "$migration_advisory_key" =~ ^[1-9][0-9]{0,17}$ ]] || {
  printf 'Invalid migration advisory lock contract.\n' >&2
  exit 64
}

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

container_running() {
  [[ "$(sudo -n docker container inspect --format '{{.State.Status}}' "$1" 2>/dev/null || true)" == "running" ]]
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

image_contract() {
  sudo -n docker image inspect --format \
    '{{.Os}}|{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "com.projectai.release.environment"}}' \
    "$1"
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
  compose_file=/srv/projectai/docker-compose.production-rollout.yml
  base_url=http://127.0.0.1:3100/tool/projectai
  public_url=https://gridworks.cn/tool/projectai/
  backup_root=/srv/projectai/backups
  postgres=project-ai-os-postgres
  minio=project-ai-os-minio
  document_worker=project-ai-os-document-worker
  embedding_worker=project-ai-os-embedding-worker
  migration_lock=/srv/projectai/.production-migration-lock
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
  migration_lock=/srv/projectai-staging/.staging-migration-lock
fi
[[ "$migration_lock" == "$expected_migration_lock_file" ]] || {
  printf 'Migration lock contract does not match the target environment.\n' >&2
  exit 64
}

emit app.containerId "$(container_field "$app" '{{.Id}}')"
app_image="$(container_field "$app" '{{.Image}}')"
emit app.imageDigest "$app_image"
IFS='|' read -r app_image_os app_image_architecture app_image_revision app_image_environment <<<"$(image_contract "$app_image")"
emit app.imageOs "${app_image_os:-null}"
emit app.imageArchitecture "${app_image_architecture:-null}"
emit app.imageRevision "${app_image_revision:-null}"
emit app.imageEnvironment "${app_image_environment:-null}"
emit app.createdAt "$(container_field "$app" '{{.Created}}')"
emit app.startedAt "$(container_field "$app" '{{.State.StartedAt}}')"
emit app.restartCount "$(container_field "$app" '{{.RestartCount}}')"
emit app.status "$(container_field "$app" '{{.State.Status}}')"
emit app.health "$(container_field "$app" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
emit app.composeProject "$(container_field "$app" '{{index .Config.Labels "com.docker.compose.project"}}')"
app_commit="$app_image_revision"
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
  emit database.inventoryKnown true
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
  migration_advisory="$(sudo -n docker exec -i "$postgres" sh -c 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<SQL 2>/dev/null || true
with attempted as (
  select pg_try_advisory_lock(${migration_advisory_key}::bigint) as acquired
)
select case
  when acquired is false then 'held'
  when pg_advisory_unlock(${migration_advisory_key}::bigint) then 'clear'
  else 'unknown'
end
from attempted;
SQL
)"
  case "$migration_advisory" in
    clear|held) ;;
    *) migration_advisory=unknown ;;
  esac
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
  for active_count in \
    "$document_jobs" \
    "$embedding_jobs" \
    "$embedding_batches" \
    "$embedding_calls" \
    "$retrieval_runs" \
    "$query_calls" \
    "$executions"; do
    [[ "$active_count" =~ ^[0-9]+$ ]] || {
      printf 'Active workload inventory is incomplete.\n' >&2
      exit 70
    }
  done
else
  emit database.present false
  emit database.inventoryKnown not-applicable
  emit database.containerId null
  emit database.imageDigest null
  emit database.health absent
  emit database.version absent
  emit database.sizeBytes 0
  emit database.pgvectorVersion absent
  emit database.migrationCount none
  if [[ "$environment" == "production" ]]; then
    document_jobs=null
    embedding_jobs=null
    embedding_batches=null
    embedding_calls=null
    retrieval_runs=null
    query_calls=null
    executions=null
  else
    document_jobs=0
    embedding_jobs=0
    embedding_batches=0
    embedding_calls=0
    retrieval_runs=0
    query_calls=0
    executions=0
  fi
fi

if container_exists "$minio"; then
  emit objectStorage.present true
  emit objectStorage.containerId "$(container_field "$minio" '{{.Id}}')"
  emit objectStorage.imageDigest "$(container_field "$minio" '{{.Image}}')"
  emit objectStorage.health "$(container_field "$minio" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  bucket_name="$(sudo -n docker exec "$app" sh -c 'printf "%s" "$OBJECT_STORAGE_BUCKET"' 2>/dev/null || true)"
  if [[ ! "$bucket_name" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || [[ "$bucket_name" == *..* ]]; then
    emit objectStorage.inventoryKnown false
    emit objectStorage.bucketNameHash null
    emit objectStorage.objectCount null
    emit objectStorage.totalBytes null
    emit objectStorage.bucketCount null
  else
    emit objectStorage.bucketNameHash "sha256:$(printf '%s' "$bucket_name" | sha256sum | cut -d' ' -f1)"
    minio_root_user="$(sudo -n docker exec "$minio" sh -c 'printf "%s" "$MINIO_ROOT_USER"' 2>/dev/null || true)"
    minio_root_password="$(sudo -n docker exec "$minio" sh -c 'printf "%s" "$MINIO_ROOT_PASSWORD"' 2>/dev/null || true)"
    minio_client_image=quay.io/minio/mc@sha256:aead63c77f9db9107f1696fb08ecb0faeda23729cde94b0f663edf4fe09728e3
    if [[ -z "$minio_root_user" || -z "$minio_root_password" ]]; then
      storage_values=""
    else
      bucket_lines="$(sudo -n docker run --rm \
        --network "container:$minio" \
        --entrypoint /bin/sh \
        --env "MC_INVENTORY_USER=$minio_root_user" \
        --env "MC_INVENTORY_PASSWORD=$minio_root_password" \
        "$minio_client_image" -ec '
          config_dir="$(mktemp -d /tmp/projectai-inventory.XXXXXX)"
          trap "rm -rf $config_dir" EXIT
          mc --quiet --config-dir "$config_dir" alias set inventory http://127.0.0.1:9000 "$MC_INVENTORY_USER" "$MC_INVENTORY_PASSWORD" >/dev/null
          mc --config-dir "$config_dir" ls --json inventory
        ' 2>/dev/null || true)"
      bucket_count="$(printf '%s\n' "$bucket_lines" | sed '/^$/d' | wc -l | tr -d ' ')"
      storage_summary="$(sudo -n docker run --rm \
        --network "container:$minio" \
        --entrypoint /bin/sh \
        --env "MC_INVENTORY_USER=$minio_root_user" \
        --env "MC_INVENTORY_PASSWORD=$minio_root_password" \
        --env "MC_INVENTORY_BUCKET=$bucket_name" \
        "$minio_client_image" -ec '
          config_dir="$(mktemp -d /tmp/projectai-inventory.XXXXXX)"
          trap "rm -rf $config_dir" EXIT
          mc --quiet --config-dir "$config_dir" alias set inventory http://127.0.0.1:9000 "$MC_INVENTORY_USER" "$MC_INVENTORY_PASSWORD" >/dev/null
          mc --quiet --config-dir "$config_dir" stat "inventory/$MC_INVENTORY_BUCKET" >/dev/null
          mc --config-dir "$config_dir" du --json --recursive "inventory/$MC_INVENTORY_BUCKET"
        ' 2>/dev/null || true)"
      object_count="$(printf '%s' "$storage_summary" | sed -n 's/.*"objects":\([0-9][0-9]*\).*/\1/p' | tail -1)"
      object_bytes="$(printf '%s' "$storage_summary" | sed -n 's/.*"size":\([0-9][0-9]*\).*/\1/p' | tail -1)"
      if [[ "$bucket_count" =~ ^[0-9]+$ && "$object_count" =~ ^[0-9]+$ && "$object_bytes" =~ ^[0-9]+$ ]]; then
        storage_values="$bucket_count|$object_count|$object_bytes"
      else
        storage_values=""
      fi
    fi
    if [[ "$storage_values" =~ ^[0-9]+\|[0-9]+\|[0-9]+$ ]]; then
      IFS='|' read -r bucket_count object_count object_bytes <<<"$storage_values"
      emit objectStorage.inventoryKnown true
      emit objectStorage.objectCount "$object_count"
      emit objectStorage.totalBytes "$object_bytes"
      emit objectStorage.bucketCount "$bucket_count"
    else
      emit objectStorage.inventoryKnown false
      emit objectStorage.objectCount null
      emit objectStorage.totalBytes null
      emit objectStorage.bucketCount null
    fi
  fi
else
  emit objectStorage.present false
  emit objectStorage.inventoryKnown not-applicable
  emit objectStorage.bucketNameHash null
  emit objectStorage.containerId null
  emit objectStorage.imageDigest null
  emit objectStorage.health absent
  emit objectStorage.objectCount 0
  emit objectStorage.totalBytes 0
  emit objectStorage.bucketCount 0
fi

if container_running "$document_worker"; then
  emit services.documentWorker true
  document_worker_image="$(container_field "$document_worker" '{{.Image}}')"
  emit services.documentWorkerImageDigest "$document_worker_image"
  IFS='|' read -r worker_os worker_architecture worker_revision worker_environment <<<"$(image_contract "$document_worker_image")"
  emit services.documentWorkerImageOs "${worker_os:-null}"
  emit services.documentWorkerImageArchitecture "${worker_architecture:-null}"
  emit services.documentWorkerImageRevision "${worker_revision:-null}"
  emit services.documentWorkerImageEnvironment "${worker_environment:-null}"
  emit services.documentWorkerHealth "$(container_field "$document_worker" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  emit services.documentWorkerRestartCount "$(container_field "$document_worker" '{{.RestartCount}}')"
else
  emit services.documentWorker false
  emit services.documentWorkerImageDigest null
  emit services.documentWorkerImageOs null
  emit services.documentWorkerImageArchitecture null
  emit services.documentWorkerImageRevision null
  emit services.documentWorkerImageEnvironment null
  emit services.documentWorkerHealth absent
  emit services.documentWorkerRestartCount 0
fi
if container_running "$embedding_worker"; then
  emit services.embeddingWorker true
  embedding_worker_image="$(container_field "$embedding_worker" '{{.Image}}')"
  emit services.embeddingWorkerImageDigest "$embedding_worker_image"
  IFS='|' read -r worker_os worker_architecture worker_revision worker_environment <<<"$(image_contract "$embedding_worker_image")"
  emit services.embeddingWorkerImageOs "${worker_os:-null}"
  emit services.embeddingWorkerImageArchitecture "${worker_architecture:-null}"
  emit services.embeddingWorkerImageRevision "${worker_revision:-null}"
  emit services.embeddingWorkerImageEnvironment "${worker_environment:-null}"
  emit services.embeddingWorkerHealth "$(container_field "$embedding_worker" '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
  emit services.embeddingWorkerRestartCount "$(container_field "$embedding_worker" '{{.RestartCount}}')"
else
  emit services.embeddingWorker false
  emit services.embeddingWorkerImageDigest null
  emit services.embeddingWorkerImageOs null
  emit services.embeddingWorkerImageArchitecture null
  emit services.embeddingWorkerImageRevision null
  emit services.embeddingWorkerImageEnvironment null
  emit services.embeddingWorkerHealth absent
  emit services.embeddingWorkerRestartCount 0
fi

emit active.documentJobs "$document_jobs"
emit active.embeddingJobs "$embedding_jobs"
emit active.embeddingBatches "$embedding_batches"
emit active.embeddingProviderCalls "$embedding_calls"
emit active.retrievalRuns "$retrieval_runs"
emit active.queryEmbeddingCalls "$query_calls"
emit active.aiExecutions "$executions"

IFS=$'\t' read -r backup_state backup_size backup_time <<<"$(latest_backup "$backup_root")"
emit backup.directory "$backup_root"
emit backup.state "$backup_state"
emit backup.latestSizeBytes "$backup_size"
emit backup.latestCompletedAt "${backup_time:-null}"
if container_exists "$postgres"; then
  if sudo -n docker exec "$postgres" pg_dump --version >/dev/null 2>&1; then
    emit backup.pgDumpAvailable true
  else
    emit backup.pgDumpAvailable false
  fi
  if sudo -n docker exec "$postgres" pg_restore --version >/dev/null 2>&1; then
    emit backup.pgRestoreAvailable true
  else
    emit backup.pgRestoreAvailable false
  fi
else
  emit backup.pgDumpAvailable false
  emit backup.pgRestoreAvailable false
fi
if container_exists "$postgres" || container_exists "$minio"; then
  if sudo -n test -d "$backup_root"; then
    emit backup.directoryExists true
  else
    emit backup.directoryExists false
  fi
  if sudo -n test -d "$backup_root" && sudo -n test -w "$backup_root"; then
    emit backup.directoryWritable true
  else
    emit backup.directoryWritable false
  fi
  backup_available="$(df -B1 "$backup_root" 2>/dev/null | awk 'NR==2 {print $4}' || true)"
  if [[ "$backup_available" =~ ^[0-9]+$ ]]; then
    emit backup.availableBytes "$backup_available"
  else
    emit backup.availableBytes null
  fi
else
  emit backup.directoryExists false
  emit backup.directoryWritable false
  emit backup.availableBytes 0
fi

if [[ "$environment" == "production" ]]; then
  deployment_lock=/srv/projectai/.production-rollout-lock
else
  deployment_lock=/srv/projectai-staging/.staging-deploy-lock
fi
if sudo -n test -e "$deployment_lock" || sudo -n test -e "${deployment_lock}.lifecycle"; then
  emit locks.deployment true
else
  emit locks.deployment false
fi
if sudo -n test -e "$migration_lock"; then
  migration_file=true
else
  migration_file=false
fi
if container_exists "$postgres"; then
  migration_applicable=true
else
  migration_applicable=false
  migration_advisory=not-applicable
fi
if [[ "$migration_file" == "true" || "$migration_advisory" == "held" ]]; then
  migration_locked=true
else
  migration_locked=false
fi
emit locks.migrationApplicable "$migration_applicable"
emit locks.migrationFile "$migration_file"
emit locks.migrationAdvisory "$migration_advisory"
emit locks.migration "$migration_locked"
