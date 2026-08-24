# Slim deployment

Project AI and RAGFlow remain separate stacks connected only by the internal `projectai-ragflow-private` Docker network.

1. Complete `deploy/ragflow/README.md` host resource gate and RAGFlow API acceptance.
2. Copy `.env.staging.example` to the untracked `.env.staging` and fill non-secret configuration.
3. Install PostgreSQL, Qwen and RAGFlow secret files with mode `0400` outside the repository.
4. Validate and start Project AI:

```bash
export NEXT_PUBLIC_COMMIT_SHA="$(git rev-parse HEAD)"
export NEXT_PUBLIC_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export POSTGRES_PASSWORD_FILE_HOST=/srv/projectai/secrets/postgres_password
export QWEN_API_KEY_FILE_HOST=/srv/projectai/secrets/qwen_api_key
export RAGFLOW_API_KEY_FILE_HOST=/srv/projectai/secrets/ragflow_api_key
docker compose -f docker-compose.slim.yml config >/dev/null
docker compose -f docker-compose.slim.yml build
docker compose -f docker-compose.slim.yml up -d
docker compose -f docker-compose.slim.yml ps
curl --fail http://127.0.0.1:3101/tool/projectai-staging/api/health
```

Rollback Project AI without deleting data:

```bash
docker compose -f docker-compose.slim.yml stop projectai-staging
git switch legacy/project-ai-full
```

Never run `down -v`; never delete legacy MinIO or old database tables during the migration observation window.
