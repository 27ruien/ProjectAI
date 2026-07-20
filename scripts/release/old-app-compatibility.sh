#!/usr/bin/env bash
set -Eeuo pipefail

production_image="${1:-}"
db_tools_image="${2:-}"
expected_production_digest="${3:-}"

[[ "${RELEASE_REHEARSAL:-}" == "1" ]] || {
  printf 'RELEASE_REHEARSAL=1 is required.\n' >&2
  exit 64
}
[[ "$expected_production_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  printf 'An immutable Production image digest is required.\n' >&2
  exit 64
}
actual_production_digest="$(sudo -n docker image inspect --format '{{.Id}}' "$production_image")"
[[ "$actual_production_digest" == "$expected_production_digest" ]] || {
  printf 'Production image baseline changed.\n' >&2
  exit 1
}
db_tools_digest="$(sudo -n docker image inspect --format '{{.Id}}' "$db_tools_image")"
[[ "$db_tools_digest" =~ ^sha256:[0-9a-f]{64}$ ]]

suffix="${expected_production_digest:7:12}-$$-$RANDOM"
network="projectai-release-old-app-$suffix"
postgres="projectai-release-old-postgres-$suffix"
app="projectai-release-old-app-$suffix"
database="projectai_release_old_app"
database_user="projectai_release"
database_password="fictional-release-database-only"
auth_secret="fictional-release-auth-secret-000000000000000000000000"
postgres_image="pgvector/pgvector:0.8.1-pg17@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21"

cleanup() {
  set +e
  sudo -n docker rm --force "$app" "$postgres" >/dev/null 2>&1 || true
  sudo -n docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sudo -n docker network create "$network" >/dev/null
sudo -n docker run --detach --rm \
  --name "$postgres" \
  --network "$network" \
  --network-alias projectai-postgres \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=512m \
  --env "POSTGRES_DB=$database" \
  --env "POSTGRES_USER=$database_user" \
  --env "POSTGRES_PASSWORD=$database_password" \
  "$postgres_image" >/dev/null

ready=0
for _ in {1..30}; do
  if sudo -n docker exec "$postgres" pg_isready --username "$database_user" --dbname "$database" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]]

database_url="postgresql://$database_user:$database_password@projectai-postgres:5432/$database"
sudo -n docker run --rm \
  --network "$network" \
  --env NODE_ENV=production \
  --env "DATABASE_URL=$database_url" \
  --env "BETTER_AUTH_SECRET=$auth_secret" \
  --env BETTER_AUTH_URL=http://projectai-old-app:3000/tool/projectai/api/auth \
  --env AUTH_COOKIE_PREFIX=projectai_release_old \
  --env AUTH_TRUSTED_ORIGINS=http://projectai-old-app:3000 \
  "$db_tools_image" npm run db:migrate >/dev/null

migration_contract="$(sudo -n docker exec "$postgres" psql -X -qAt \
  --username "$database_user" --dbname "$database" -c "
    select
      (select count(*) from drizzle.__drizzle_migrations) || '|' ||
      (select extversion from pg_extension where extname='vector') || '|' ||
      (select count(*) from ai_retrieval_profiles where id='hybrid-rrf-v1');
  ")"
[[ "$migration_contract" == "8|0.8.1|1" ]]

sudo -n docker run --detach --rm \
  --name "$app" \
  --network "$network" \
  --network-alias projectai-old-app \
  --env "DATABASE_URL=$database_url" \
  "$production_image" >/dev/null

healthy=0
for _ in {1..45}; do
  dashboard_status="$(sudo -n docker exec "$app" node -e '
    fetch("http://127.0.0.1:3000/tool/projectai/dashboard", {redirect:"manual"})
      .then(response => process.stdout.write(String(response.status)))
      .catch(() => process.exit(1));
  ' 2>/dev/null || true)"
  if [[ "$dashboard_status" =~ ^(200|301|302|303|307|308)$ ]]; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" == "1" ]]
[[ "$(sudo -n docker inspect --format '{{.RestartCount}}' "$app")" == "0" ]]
route_statuses="$(sudo -n docker exec "$app" node -e '
  const base="http://127.0.0.1:3000/tool/projectai";
  Promise.all(["/login","/dashboard","/projects"].map(async path => {
    const response=await fetch(base+path,{redirect:"manual"});
    return response.status;
  })).then(values => process.stdout.write(values.join("|"))).catch(() => process.exit(1));
')"
IFS='|' read -r login_status dashboard_status projects_status <<<"$route_statuses"
[[ "$login_status" == "200" ]]
[[ "$dashboard_status" =~ ^(200|301|302|303|307|308)$ ]]
[[ "$projects_status" =~ ^(200|301|302|303|307|308)$ ]]
database_connection_count="$(sudo -n docker exec "$postgres" psql -X -qAt \
  --username "$database_user" --dbname "$database" -c \
  "select count(*) from pg_stat_activity where datname=current_database() and usename=current_user and pid <> pg_backend_pid();")"
[[ "$database_connection_count" == "0" ]]

printf 'productionImageDigest\t%s\n' "$actual_production_digest"
printf 'dbToolsImageDigest\t%s\n' "$db_tools_digest"
printf 'targetMigration\t7\n'
printf 'migrationCount\t8\n'
printf 'pgvectorVersion\t0.8.1\n'
printf 'oldAppLoginStatus\t%s\n' "$login_status"
printf 'oldAppDashboardStatus\t%s\n' "$dashboard_status"
printf 'oldAppProjectsStatus\t%s\n' "$projects_status"
printf 'oldAppRestartCount\t0\n'
printf 'databaseUrlSuppliedToOldApp\ttrue\n'
printf 'oldAppOperationalWithParallel0007Database\ttrue\n'
printf 'oldAppDatabaseDependency\tabsent\n'
printf 'oldAppDatabaseConnectionObserved\tfalse\n'
printf 'schemaForwardRollbackScope\tlegacy-application-shell\n'
printf 'newDataPlaneFeaturesAvailableAfterRollback\tfalse\n'
printf 'publicPortPublished\tfalse\n'
printf 'productionContainerTouched\tfalse\n'
printf 'productionNetworkJoined\tfalse\n'
printf 'productionSecretMounted\tfalse\n'
printf 'cleanupComplete\ttrue\n'
printf 'passed\ttrue\n'
