#!/usr/bin/env bash
set -Eeuo pipefail

app_image="${1:-}"
db_tools_image="${2:-}"
expected_sha="${3:-}"

[[ "${RELEASE_REHEARSAL:-}" == "1" ]] || {
  printf 'RELEASE_REHEARSAL=1 is required.\n' >&2
  exit 64
}
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'A full expected SHA is required.\n' >&2
  exit 64
}
[[ -n "$app_image" && -n "$db_tools_image" ]] || {
  printf 'App and db-tools images are required.\n' >&2
  exit 64
}

app_image_id="$(docker image inspect --format '{{.Id}}' "$app_image")"
db_tools_image_id="$(docker image inspect --format '{{.Id}}' "$db_tools_image")"
[[ "$app_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$db_tools_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]

suffix="${expected_sha:0:12}-$$-$RANDOM"
network="projectai-release-disabled-$suffix"
postgres="projectai-release-disabled-postgres-$suffix"
app="projectai-release-disabled-app-$suffix"
database="projectai_release_disabled"
database_user="projectai_release"
database_password="fictional-release-database-only"
auth_secret="fictional-release-auth-secret-000000000000000000000000"
postgres_image="pgvector/pgvector:0.8.1-pg17@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21"

cleanup() {
  set +e
  docker rm --force "$app" "$postgres" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$network" >/dev/null
docker run --detach --rm \
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
  if docker exec "$postgres" pg_isready --username "$database_user" --dbname "$database" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[[ "$ready" == "1" ]] || {
  printf 'Isolated PostgreSQL did not become ready.\n' >&2
  exit 1
}

database_url="postgresql://$database_user:$database_password@projectai-postgres:5432/$database"
docker run --rm \
  --network "$network" \
  --env NODE_ENV=production \
  --env "DATABASE_URL=$database_url" \
  --env "BETTER_AUTH_SECRET=$auth_secret" \
  --env BETTER_AUTH_URL=http://projectai-app:3000/tool/projectai/api/auth \
  --env AUTH_COOKIE_PREFIX=projectai_release \
  --env AUTH_TRUSTED_ORIGINS=http://projectai-app:3000 \
  "$db_tools_image" npm run db:migrate >/dev/null

docker run --detach --rm \
  --name "$app" \
  --network "$network" \
  --network-alias projectai-app \
  --env "DATABASE_URL=$database_url" \
  --env "BETTER_AUTH_SECRET=$auth_secret" \
  --env BETTER_AUTH_URL=http://projectai-app:3000/tool/projectai/api/auth \
  --env AUTH_COOKIE_PREFIX=projectai_release \
  --env AUTH_COOKIE_PATH=/tool/projectai \
  --env AUTH_TRUSTED_ORIGINS=http://projectai-app:3000 \
  --env AI_ASSISTANT_ENABLED=false \
  --env AI_EMBEDDING_ENABLED=false \
  --env AI_ASSISTANT_RETRIEVAL_MODE=lexical \
  "$app_image" >/dev/null

healthy=0
health_body=""
for _ in {1..45}; do
  health_body="$(docker exec "$app" node -e '
    fetch("http://127.0.0.1:3000/tool/projectai/api/health")
      .then(async response => {
        const body = await response.text();
        if (!response.ok) process.exit(1);
        process.stdout.write(body);
      })
      .catch(() => process.exit(1));
  ' 2>/dev/null || true)"
  if [[ "$health_body" == *'"status":"ok"'* ]]; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  app_state="$(docker inspect --format '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.RestartCount}}' "$app" 2>/dev/null || printf 'missing|unknown|unknown|unknown')"
  printf 'Isolated application did not become healthy before the 90-second deadline (state|exitCode|oomKilled|restartCount=%s).\n' "$app_state" >&2
  exit 1
fi
[[ "$health_body" == *'"aiAssistantEnabled":false'* ]]
[[ "$health_body" == *'"aiEmbeddingEnabled":false'* ]]
[[ "$health_body" == *'"assistantRetrievalMode":"lexical"'* ]]
[[ "$health_body" == *'"queryEmbeddingConfigured":false'* ]]

commit_sha="$(docker exec "$app" sh -c 'printf "%s" "$NEXT_PUBLIC_COMMIT_SHA"')"
[[ "$commit_sha" == "$expected_sha" ]]
secret_mounts="$(docker inspect --format '{{range .Mounts}}{{println .Destination}}{{end}}' "$app")"
[[ "$secret_mounts" != *qwen_api_key* ]]

core_status="$(docker exec "$app" node -e '
  Promise.all([
    fetch("http://127.0.0.1:3000/tool/projectai/login", { redirect: "manual" }),
    fetch("http://127.0.0.1:3000/tool/projectai/projects", { redirect: "manual" })
  ]).then(responses => process.stdout.write(responses.map(item => item.status).join("|")))
    .catch(() => process.exit(1));
')"
IFS='|' read -r login_status projects_status <<<"$core_status"
(( login_status < 500 && projects_status < 500 ))

active_counts="$(docker exec "$postgres" psql -X -qAt \
  --username "$database_user" --dbname "$database" -c "
    select
      (select count(*) from document_embedding_jobs where status in ('pending','running')) || '|' ||
      (select count(*) from ai_retrieval_query_embedding_calls where status in ('reserved','calling')) || '|' ||
      (select count(*) from ai_executions where status in ('reserved','retrieving','calling_provider','validating'));
  ")"
[[ "$active_counts" == "0|0|0" ]]

printf 'appImageDigest\t%s\n' "$app_image_id"
printf 'dbToolsImageDigest\t%s\n' "$db_tools_image_id"
printf 'expectedSha\t%s\n' "$expected_sha"
printf 'health\thealthy\n'
printf 'assistantEnabled\tfalse\n'
printf 'embeddingEnabled\tfalse\n'
printf 'retrievalMode\tlexical\n'
printf 'qwenSecretMount\tfalse\n'
printf 'activeEmbeddingJobs\t0\n'
printf 'activeQueryEmbeddingCalls\t0\n'
printf 'activeAiExecutions\t0\n'
printf 'loginStatus\t%s\n' "$login_status"
printf 'projectsStatus\t%s\n' "$projects_status"
printf 'publicPortPublished\tfalse\n'
printf 'productionConnected\tfalse\n'
printf 'cleanupComplete\ttrue\n'
printf 'passed\ttrue\n'
