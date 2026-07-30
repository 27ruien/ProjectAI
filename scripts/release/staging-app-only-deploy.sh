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

cd "$remote_dir"
sudo test -e "$deploy_marker"
sudo test -f "$compose_file"
sudo test -f "$app_only_compose_file"
sudo test -f "$env_file"
sudo test -f "$embedding_env_file"

for service_container in "$db_container_name" "$minio_container_name"; do
  running="$(sudo docker inspect --format '{{.State.Running}}' "$service_container")"
  health="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$service_container")"
  [[ "$running" == "true" && "$health" == "healthy" ]]
done

database_counts() {
  sudo docker exec "$db_container_name" sh -eu -c '
    psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
      select concat_ws('|',
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
"${compose[@]}" up --detach --no-deps --no-build --pull never \
  projectai-document-worker projectai-embedding-worker projectai-staging

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

app_environment="$(sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_name")"
grep -Fxq "NEXT_PUBLIC_COMMIT_SHA=$commit_sha" <<<"$app_environment"
grep -Fxq "AI_ASSISTANT_ENABLED=true" <<<"$app_environment"
grep -Fxq "AI_PROJECT_ASSISTANT_PROFILE_ID=qwen-project-assistant-cn-v2" <<<"$app_environment"
grep -Fxq "AI_ASSISTANT_RETRIEVAL_MODE=hybrid" <<<"$app_environment"
grep -Fxq "AI_EMBEDDING_ENABLED=true" <<<"$app_environment"
grep -Fxq "AI_EMBEDDING_PROFILE_ID=qwen3.7-text-embedding-cn-v2" <<<"$app_environment"
grep -Fxq "AI_EMBEDDING_DIMENSIONS=1024" <<<"$app_environment"

embedding_environment="$(sudo docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$embedding_worker_container_name")"
grep -Fxq "AI_EMBEDDING_ENABLED=true" <<<"$embedding_environment"
grep -Fxq "AI_EMBEDDING_PROFILE_ID=qwen3.7-text-embedding-cn-v2" <<<"$embedding_environment"
grep -Fxq "AI_EMBEDDING_DIMENSIONS=1024" <<<"$embedding_environment"

curl --fail --silent --max-time 10 \
  "http://127.0.0.1:3101${base_path}/api/health" | grep -q '"status":"ok"'

after_counts="$(database_counts)"
[[ "$after_counts" == "$before_counts" ]]

printf 'App-only Staging deployment completed without Migration, Seed, password reset, or credential-based E2E.\n'
printf 'Preserved row counts (users|accounts|sessions|projects|documents|versions): %s\n' "$after_counts"
