#!/usr/bin/env bash
set -Eeuo pipefail

# Narrow Staging deployment mode: take a database backup, apply the committed
# migrations only, then reuse the app-only runtime replacement. It never seeds
# accounts, resets passwords, or performs credential-based browser checks.
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
sudo test -f "$env_file"
sudo test -f "$embedding_env_file"
sudo test -d "$remote_dir/backups"
sudo test ! -L "$remote_dir/backups"
[[ "$(sudo readlink -f -- "$remote_dir/backups")" == "$remote_dir/backups" ]]
[[ "$(sudo docker inspect --format '{{.State.Health.Status}}' "$db_container_name")" == "healthy" ]]

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup="$remote_dir/backups/projectai-staging-pre-app-migrate-${timestamp}-${commit_sha}.dump"
partial="${backup}.partial"
database_bytes="$(sudo docker exec "$db_container_name" sh -ec '
  PGPASSWORD="$POSTGRES_PASSWORD" psql --tuples-only --no-align \
    --host=127.0.0.1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --command="SELECT pg_database_size(current_database())"
')"
[[ "$database_bytes" =~ ^[0-9]+$ ]]
available_bytes="$(sudo df -PB1 "$remote_dir/backups" | awk 'NR == 2 { print $4 }')"
[[ "$available_bytes" =~ ^[0-9]+$ ]]
required_backup_bytes=$((database_bytes * 2 + 268435456))
(( available_bytes >= required_backup_bytes ))
sudo install -m 0600 -o root -g root /dev/null "$partial"
if ! sudo docker exec "$db_container_name" sh -ec '
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl \
    --host=127.0.0.1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"
' | sudo tee "$partial" >/dev/null; then
  sudo rm -f "$partial"
  exit 1
fi
sudo test -s "$partial"
sudo cat "$partial" | sudo docker exec --interactive "$db_container_name" pg_restore --list >/dev/null
sudo mv "$partial" "$backup"
sudo chown root:root "$backup"
sudo chmod 600 "$backup"

compose=(
  sudo env
  "NEXT_PUBLIC_COMMIT_SHA=$commit_sha"
  "NEXT_PUBLIC_APP_VERSION=$app_version"
  "NEXT_PUBLIC_BUILD_TIME=$build_time"
  "STAGING_DB_TOOLS_IMAGE=project-ai-os-staging-db-tools:${commit_sha}"
  docker compose
  --env-file "$env_file"
  --env-file "$embedding_env_file"
  --project-name "$compose_project"
  --file "$compose_file"
  --profile operations
)
"${compose[@]}" config --quiet
"${compose[@]}" run --rm --no-deps --pull never --interactive=false --no-TTY \
  projectai-migrate npm run db:migrate

exec sudo bash "$remote_dir/scripts/release/staging-app-only-deploy.sh" \
  "$remote_dir" "$env_file" "$embedding_env_file" "$compose_project" "$compose_file" \
  "$app_only_compose_file" "$app_image_ref" "$app_image_id" "$commit_sha" "$app_version" \
  "$build_time" "$container_name" "$worker_container_name" "$embedding_worker_container_name" \
  "$db_container_name" "$minio_container_name" "$base_path" "$deploy_marker"
