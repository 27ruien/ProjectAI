# Project AI Slim Migration Report

## 1. Product Scope

Slim 主产品只保留 Projects、Project Knowledge、Cross-project AI 和成熟的基础认证/成员管理。当前没有旧工具同时满足固定流程、独立价值、高频、无领域耦合、无 Agent Loop 五个条件，因此不展示空 Tools 入口，也没有新增工具。

## 2. Removed

Active UI、Route、Service、Schema Adapter、Worker、测试夹具和文案中已移除 Requirement、Scope、Action、Risk、Weekly Report、Timesheet、Product Map、Skill/Workflow/Agent、Company Knowledge、普通用户 Model Management、Conversation Memory，以及自研解析、Chunk、FTS、Embedding、pgvector、RRF 和 Retrieval Run 链路。

## 3. Frozen

完整重构前快照保存在：

- Branch: `legacy/project-ai-full`
- Tag: `pre-slim-ragflow-migration`
- Snapshot commit: `56bfec5`

Slim 工作位于 `refactor/project-ai-slim`。本轮未提交、未推送、未部署 Production。

## 4. Architecture

```text
Browser
   |
   v
Project AI Backend ---- AI Gateway ---- LLM
   |        |
   |        `-- Project authorization + Evidence Guard
   |
   +-- PostgreSQL: Auth, Project, ProjectMember, Document mapping, Audit
   `-- RAGFlow official API: Dataset, Document, Parse, Retrieval
```

Project AI 不连接 RAGFlow 的 MySQL、Elasticsearch/OpenSearch、MinIO 或 Redis。

## 5. RAGFlow

- Version: official stable `v0.27.0`, CPU profile.
- Deployment: **BLOCKED by host capacity gate; not started.**
- Host evidence: x86_64, 2 CPU, about 3.4 GiB RAM, about 20.8 GiB available disk, Docker 29.5.2, Compose 5.1.4, `vm.max_map_count=65530`.
- Required gate: at least 4 CPU, 16 GiB RAM, 50 GiB available disk, and `vm.max_map_count >= 262144`.
- Planned containers: `ragflow-cpu`, selected document engine, MySQL, MinIO and Redis; internal components have no host ports.
- Planned Project AI internal URL: `http://ragflow-cpu:9380` on `projectai-ragflow-private`.
- Health: **BLOCKED**, not reported as PASS.
- Live Dataset test: **BLOCKED**.
- Live Retrieval test: **BLOCKED**.
- Official API adapter and Fake RAGFlow acceptance: **PASS**.

No Staging server mutation and no Production operation occurred after the failed read-only capacity gate.

## 6. Database

Active Drizzle exports contain 14 tables covering Better Auth identity/session, users, organizations/departments, Projects, ProjectMembers, Document mapping and Audit. Project now stores Dataset mapping and `pending/ready/failed` knowledge state. Document stores only the RAGFlow document mapping, parse state, metadata and uploader.

Migration `0034` is additive. It disables legacy Project/Document knowledge-space triggers but deliberately keeps 90 historical physical tables and old binaries for rollback. Physical drops require the separate reviewed cleanup plan.

## 7. Permission

```text
Project Membership = Project Knowledge Access
```

The browser submits `projectId`, never `datasetId`. The backend resolves authorized Projects, maps their Dataset IDs, retrieves each Project independently with bounded concurrency, and drops every Evidence item whose Dataset or Document mapping is not locally authorized. An explicit foreign Project selection returns the same 404 boundary as a missing Project.

## 8. Migration

Live migration was not run because RAGFlow was not deployed:

- Projects migrated: 0
- Datasets created: 0
- Documents migrated: 0
- Success: 0
- Failed: 0

The implemented CLI supports `--dry-run`, exactly one of `--project <id>`/`--all`, and `--resume`; it validates legacy object size/SHA-256, reuses deterministic Dataset/Document mappings, polls parsing, continues bounded failures and emits a summary.

## 9. Tests

| Gate | Result |
| --- | --- |
| Auth / unauthenticated redirect / DB Session | PASS |
| Project list isolation, create, edit | PASS |
| Member add/change/remove and last-manager concurrency | PASS |
| Dataset provision/mapping with official-API Fake | PASS |
| Upload / batch contract / Ready | PASS |
| Failed parse / retry / delete | PASS |
| Single-project Retrieval | PASS |
| Citation and backend Evidence Guard | PASS |
| Cross-project bounded Retrieval | PASS |
| Foreign Project URL/body tampering | PASS |
| A/B Canary isolation | PASS |
| Migration 0000-0034 on isolated PostgreSQL/pgvector | PASS |
| Typecheck / ESLint | PASS |
| Unit/render/proxy tests: 16 + 7 | PASS |
| DB integration tests: 26 | PASS |
| Chromium E2E tests: 5 | PASS |
| Vinext production build | PASS |
| Live RAGFlow API | BLOCKED: host resources |

Query metrics include Project count, Dataset count, retrieved chunk count, context characters, model input/output tokens, latency and whether token usage was estimated. Context limits prove that total knowledge size is not copied into each model request.

## 10. Code Reduction

| Metric | Before | After |
| --- | ---: | ---: |
| Production source files | 484 | 147 |
| Production source LOC | 95,451 | 13,455 |
| API routes | 104 | 15 |
| Active Drizzle adapters | 90 | 14 |
| Persistent job workers | 2 | 0 |
| Runtime npm dependencies | 28 | 16 |
| Development dependencies | 23 | 22 |
| Long-running Project AI services | 5 | 2 |

The two remaining Project AI services are the web application and PostgreSQL. RAGFlow remains a separate, currently blocked knowledge-service stack.

## 11. Remaining Risks

1. The current Staging host cannot safely run RAGFlow; live health, Dataset, parsing, Retrieval and legacy migration remain unverified.
2. Historical tables and MinIO objects remain until migration acceptance and the rollback window close. This is intentional rollback debt, not Active Runtime.
3. Full `npm audit` still reports development/optional-chain advisories. `npm audit --omit=dev` has 0 Critical/High and 4 Moderate findings in Drizzle-kit's obsolete development-server loader chain; no force downgrade was applied.
4. Real Qwen answer generation and real RAGFlow model configuration require server-only keys and live Staging acceptance.

## 12. Manual Actions

Do not continue until the host has at least 4 CPU, 16 GiB RAM and 50 GiB available disk. After approved capacity expansion, persist the kernel requirement:

```bash
printf 'vm.max_map_count=262144\n' | sudo tee /etc/sysctl.d/99-ragflow.conf >/dev/null
sudo sysctl --system
sysctl vm.max_map_count
```

Then execute the pinned private deployment:

```bash
sudo install -d -m 0750 /srv/ragflow
sudo git clone --branch v0.27.0 --depth 1 https://github.com/infiniflow/ragflow.git /srv/ragflow/source
cd /srv/ragflow/source/docker
test "$(git describe --tags --exact-match)" = "v0.27.0"
sudo docker network inspect projectai-ragflow-private >/dev/null 2>&1 || sudo docker network create --internal projectai-ragflow-private
sudo install -m 0640 /srv/projectai/deploy/ragflow/docker-compose.private.override.yml ./docker-compose.private.override.yml
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml config >/dev/null
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml pull
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml up -d
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml ps
```

Create the service account/key through an SSH tunnel to `127.0.0.1:9388`; store the key without putting it in command history:

```bash
ssh -L 9388:127.0.0.1:9388 SERVER
sudo install -d -m 0700 /srv/projectai/secrets
read -rsp 'RAGFlow API key: ' RAGFLOW_SERVICE_KEY; printf '\n'
printf '%s' "$RAGFLOW_SERVICE_KEY" | sudo tee /srv/projectai/secrets/ragflow_api_key >/dev/null
unset RAGFLOW_SERVICE_KEY
sudo chmod 0400 /srv/projectai/secrets/ragflow_api_key
```

Complete the six-step official API acceptance in `deploy/ragflow/README.md`, then migrate without deleting old data:

```bash
npm run knowledge:migrate-ragflow -- --dry-run --all
npm run knowledge:migrate-ragflow -- --all --resume
```

Rollback stops only RAGFlow and preserves volumes:

```bash
cd /srv/ragflow/source/docker
sudo docker compose -f docker-compose.yml -f docker-compose.private.override.yml stop
```

Never use `down -v`; do not drop legacy tables or delete old MinIO objects until the migration summary, per-project Retrieval acceptance, backup/restore rehearsal and rollback window are approved.
