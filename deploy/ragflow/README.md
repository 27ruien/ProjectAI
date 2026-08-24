# Private RAGFlow deployment for Project AI

Pinned version: `v0.27.0` (`infiniflow/ragflow:v0.27.0`), CPU profile.

This deployment keeps RAGFlow as a separate stack. Its MySQL, Elasticsearch,
MinIO, and Redis/Valkey have no host ports. The web and API ports bind only to
loopback for SSH-administered setup and API verification. Project AI reaches
the API through the external private Docker network
`projectai-ragflow-private`.

No public Nginx route is required or permitted for RAGFlow.

## Required host preflight

Run these read-only commands before deployment:

```bash
uname -m
nproc
free -h
df -h /
docker version --format '{{.Server.Version}}'
docker compose version --short
sysctl vm.max_map_count
ss -lnt
docker network ls
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
nginx -T 2>/dev/null | sed -n '1,120p'
```

Required gate: x86_64, at least 4 CPU, 16 GiB RAM, 50 GiB available disk,
Docker 24+, Compose 2.26.1+, and `vm.max_map_count >= 262144`. Stop if the host
cannot satisfy the memory/disk gate without risking the existing Project AI
stack.

## Exact installation

```bash
sudo install -d -m 0750 /srv/ragflow
sudo git clone --branch v0.27.0 --depth 1 https://github.com/infiniflow/ragflow.git /srv/ragflow/source
cd /srv/ragflow/source/docker
test "$(git describe --tags --exact-match)" = "v0.27.0"
sudo docker network inspect projectai-ragflow-private >/dev/null 2>&1 || sudo docker network create --internal projectai-ragflow-private
sudo install -m 0640 /srv/projectai/deploy/ragflow/docker-compose.private.override.yml ./docker-compose.private.override.yml
```

Edit `/srv/ragflow/source/docker/.env` using the official template. Keep
`DEVICE=cpu`, `RAGFLOW_IMAGE=infiniflow/ragflow:v0.27.0`, choose the official
Elasticsearch document-engine profile, and replace every default database,
object-storage, and Redis password with generated values. Never copy these
values into Project AI.

Validate and start:

```bash
cd /srv/ragflow/source/docker
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml config >/dev/null
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml pull
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml up -d
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml ps
curl --fail --silent http://127.0.0.1:9380/api/v1/datasets -H 'Authorization: Bearer REPLACE_WITH_SERVICE_API_KEY'
```

Create the Project AI service account/API key through an SSH tunnel to
`127.0.0.1:9388`, configure only the embedding/rerank models needed by
retrieval, and save the API key in a root-readable secret file:

```bash
ssh -L 9388:127.0.0.1:9388 SERVER
sudo install -d -m 0700 /srv/projectai/secrets
sudo install -m 0400 /dev/stdin /srv/projectai/secrets/ragflow_api_key
```

Do not place the API key on a command line, in shell history, or in Git.

## Project AI connection

The Slim Compose already joins the private network. Set the three host secret
file paths and validate it:

```bash
export RAGFLOW_API_KEY_FILE_HOST=/srv/projectai/secrets/ragflow_api_key
export QWEN_API_KEY_FILE_HOST=/srv/projectai/secrets/qwen_api_key
export POSTGRES_PASSWORD_FILE_HOST=/srv/projectai/secrets/postgres_password
docker compose -f docker-compose.slim.yml config >/dev/null
```

The internal Project AI URL is `http://ragflow-cpu:9380`. Browser clients never
receive this URL or the service credential.

## API acceptance

After creating the service key, verify the official API—not only the web UI:

1. `POST /api/v1/datasets` creates a synthetic dataset.
2. `POST /api/v1/datasets/{id}/documents` uploads a synthetic TXT file.
3. `POST /api/v1/datasets/{id}/chunks` starts parsing.
4. `GET /api/v1/datasets/{id}/documents` reaches `run=DONE`.
5. `POST /api/v1/retrieval` returns the synthetic canary and its source.
6. `DELETE /api/v1/datasets` removes the test dataset.

## Rollback

Rollback stops only the RAGFlow stack and preserves all volumes:

```bash
cd /srv/ragflow/source/docker
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml stop
```

Do not run `down -v`, delete `/srv/ragflow`, or remove volumes during rollback.
Project AI can be rolled back to tag `pre-slim-ragflow-migration` independently.
