# RAGFlow Live POC Report

Date: 2026-08-21
Scope: Project AI Slim + RAGFlow v0.27.0 Live POC
Overall result: **GO WITH CONDITIONS**

This report contains no password, API Key, Session token, private key, customer material, or Provider payload. All test documents and canaries are synthetic.

## 1. Server

| Item | Actual | Result |
| --- | --- | --- |
| Cloud | Alibaba Cloud ECS, Shanghai Zone F, on-demand | PASS |
| Instance | `ecs.g9i.xlarge`, 4 vCPU | PASS |
| OS | Ubuntu 24.04.4 LTS, x86_64 | PASS |
| RAM | 16,066,805,760 bytes | PASS |
| Root filesystem | 63,017,381,888 bytes | PASS |
| Purpose | Dedicated RAGFlow POC | PASS |

The retired server `106.15.103.41` was not modified or queried during this deployment.

## 2. SSH Migration

| Check | Actual | Result |
| --- | --- | --- |
| Alias | `projectai-ragflow` | PASS |
| Target | `root@47.116.3.32` | PASS |
| Identity | Existing local Ed25519 key; no new private key | PASS |
| Batch login | Hostname `iZuf6439aqrzt692q9jcv1Z`, user `root` | PASS |
| Agent forwarding | Disabled | PASS |

No private key was copied to the server. Existing `authorized_keys` entries were preserved.

## 3. Disk Preflight

| Stage | Available bytes | Gate | Result |
| --- | ---: | ---: | --- |
| Initial preflight | 57,905,823,744 | >= 50,000,000,000 | PASS |
| Stable main stack, before TEI | 32,811,937,792 | >= 10,000,000,000 | PASS |
| Final POC snapshot | 21,775,433,728 | >= 10,000,000,000 | PASS |

An 8 GiB `/swapfile` was created with mode `0600` and one persistent `/etc/fstab` entry. Final Swap usage remained 0 bytes. Existing `vm.max_map_count=1048576` already exceeded the requirement and was not changed.

## 4. RAGFlow Version / Docker Health

| Item | Actual | Result |
| --- | --- | --- |
| RAGFlow tag | `v0.27.0` | PASS |
| Commit | `ec9c08d809f63ba2815090182fa225899d2437d5` | PASS |
| Mode | CPU | PASS |
| Docker CE / CLI | `29.7.2` | PASS |
| containerd | `2.3.3` | PASS |
| Buildx | `0.36.1` | PASS |
| Compose plugin | `5.5.0` | PASS |
| Docker apt source | Aliyun Docker CE Noble stable | PASS |
| GPG verification | Official Docker key retained | PASS |
| ACR accelerator | Exact account-specific accelerator configured | PASS |
| Health API | DB, document engine, Redis, storage all `ok` | PASS |

Running services: RAGFlow CPU, TEI CPU, Elasticsearch 8.11.3, MySQL 8.0.40, MinIO/Silo, and Valkey 8. All were running with restart count 0 at final collection; Elasticsearch, MySQL, MinIO, and Valkey reported healthy.

RAGFlow, TEI, MySQL, Elasticsearch, MinIO, and Valkey ports are bound only to `127.0.0.1`. The only non-loopback TCP listener is SSH on port 22. Project AI connects through a local SSH tunnel on `127.0.0.1:19380`.

## 5. Native RAGFlow Smoke Test

Dataset: `PROJECT_AI_LIVE_SMOKE`
Embedding: `Builtin / Local / BAAI/bge-small-en-v1.5` through TEI
Chat model inside RAGFlow: not required (`keyword=false`)

| Operation | Result | Latency |
| --- | --- | ---: |
| Create Dataset | PASS | 18 ms |
| Upload synthetic Markdown | PASS | 42 ms |
| Parse to `DONE` | PASS; 1 chunk, 47 tokens in the first measured run | 2,110 ms |
| `What is the CANARY_CODE?` | PASS; retrieved `RF-SHANGHAI-2026-92841` | 65 ms |
| `What is the BUDGET_CODE?` | PASS; retrieved `POC-18473` | 54 ms |
| Delete Dataset | PASS | not separately measured |

An earlier diagnostic run showed 0.509651 and 0.449631 best similarity for the two exact canary values. Every Native Smoke Dataset was deleted after evidence collection.

## 6. Project AI E2E

| Check | Result | Evidence |
| --- | --- | --- |
| Isolated local PostgreSQL POC database | PASS | Migrations current; insert-only synthetic Seed completed |
| Project creation | PASS | `RAGFlow Live Integration Test` persisted |
| Project to Dataset mapping | PASS | Non-null private mapping in DB; not serialized to browser DTO |
| Upload through Project AI HTTP API | PASS | `PROJECT_AI_E2E.md` was deleted and re-uploaded through the built standalone server |
| Document mapping | PASS | Distinct local and RAGFlow document IDs persisted |
| Parse / Ready | PASS | 3,244 ms |
| Permission rule retrieval | PASS | 116 ms |
| E2E canary retrieval | PASS | 78 ms |
| Retrieval-layer decision question | PASS | 79 ms |
| Evidence Guard | PASS | Dataset and document mapping accepted; 0 rejected |
| AI Gateway answer | PASS | Real `qwen3.7-flash` probe plus 3 single-project and 1 cross-project answers |
| Authenticated HTTP API E2E | PASS | Built standalone Node server: Health, login, Session, upload, parse, retrieval, answer, Citation, No-Evidence, RBAC and tamper checks |

The completed API evidence used the real standalone HTTP server, Route Handlers, Better Auth Session, PostgreSQL, project authorization, RAGFlow Client, Dataset/Document mapping, parsing, retrieval, and Evidence Guard. Vinext/Miniflare development mode canceled authenticated Session lookups, but the build-generated Node standalone server handled the same requests successfully. No browser UI claim is made; the task permits UI or API validation.

## 7. Citation

The Evidence Guard mapped all three single-project retrievals to `PROJECT_AI_E2E.md`, and cross-project evidence mapped separately to `PROJECT_A.md` and `PROJECT_B.md`.

All four real Qwen answers contained valid inline Evidence IDs. The service mapped those IDs to authorized public Citations: `PROJECT_AI_E2E.md` for the three single-project answers and both `PROJECT_A.md` and `PROJECT_B.md` for the cross-project answer. No Citation was accepted outside the bounded Evidence set.

## 8. No-Evidence

Question: `这个项目的合同金额是多少？`

| Check | Result |
| --- | --- |
| RAGFlow returned accepted chunks | 0 |
| Project AI status | `insufficient_evidence` |
| Answer | `null` |
| Citations | 0 |
| Provider call | None; audit input/output/total tokens are all `null` |
| Latency | 74 ms through the authenticated HTTP API |

Result: **PASS**. No amount was generated.

## 9. Permission Isolation

Three real projects were created and mapped to three distinct RAGFlow Datasets:

- Project A: `ALPHA-RF-19384`, Shanghai
- Project B: `BETA-RF-73921`, Seoul
- Project C: `FORBIDDEN-92837`

Each document reached `ready`, with measured parse times of 4,317 ms, 4,271 ms, and 1,113 ms. A member initially assigned only to Project A could read Project A and could not read Project B.

## 10. Tamper Test

| Test | Result |
| --- | --- |
| Project B document URL with A-only user | PASS, 404 |
| Project B project route with A-only user | PASS, 404 |
| Project B ask route with A-only user | PASS, 404 |
| Cross-project request body containing unauthorized B | PASS, 404 |
| Authorized Project A ask path | PASS through retrieval, real AI Gateway answer and Citation |

Missing and unauthorized projects use the same 404 response.

## 11. Cross-project

After adding a real Project B membership to the same non-admin member:

| Check | Result |
| --- | --- |
| Authorized project set contains A and B | PASS |
| Authorized project set excludes C | PASS |
| Project A retrieval | PASS, 112 ms |
| Project B retrieval | PASS, 115 ms |
| Combined A+B evidence | PASS, 227 ms sequential measurement |
| Both canaries and cities present | PASS |
| Source mapping to two documents | PASS |
| Cross-project final answer | PASS; both canaries and both cities returned with `[E1]`/`[E2]` Citations |

The production service implementation retrieves authorized projects concurrently; the 227 ms figure above is a conservative sequential evidence-validation measurement. The full authenticated cross-project request, including real Qwen generation, completed in 4,288 ms.

## 12. Forbidden Canary

`FORBIDDEN-92837` was absent from A+B Evidence. Explicitly selecting Project C with the A+B member returned 404 before retrieval. The real cross-project Answer and both returned Citations also excluded Project C and its Canary.

The prompt was not captured or logged, by design. Its exclusion is certified by construction and code-path evidence: project authorization occurs before retrieval, the prompt builder receives only the accepted bounded Evidence array, and the unauthorized Dataset/Document never enters that array. This is an inference from the verified authorization, Evidence Guard, prompt-construction boundary, final Answer and Citation results—not a claim that raw prompt content was recorded.

## 13. CPU / RAM / Swap / Disk

Final server snapshot:

| Resource | Actual |
| --- | ---: |
| RAM total | 16,066,805,760 bytes |
| RAM used | 11,282,833,408 bytes |
| RAM available | 4,783,972,352 bytes |
| Swap total / used | 8,589,930,496 / 0 bytes |
| Disk available | 21,775,433,728 bytes |

| Container | CPU | Memory |
| --- | ---: | ---: |
| RAGFlow | 0.28% | 3.779 GiB |
| TEI | 0.05% | 1.188 GiB |
| Elasticsearch | 0.15% | 4.291 GiB |
| MySQL | 2.51% | 426.8 MiB |
| MinIO | 2.10% | 91.16 MiB |
| Valkey | 2.18% | 9.7 MiB |

No OOM, restart loop, disk-full condition, or sustained Swap use was observed.

## 14. Latency

| Operation | Measured |
| --- | ---: |
| Native upload | 42 ms |
| Native parse | 2,110 ms |
| Native retrieval | 54-65 ms |
| Project AI main document parse | 3,244 ms |
| Project AI single retrieval | 78-116 ms |
| Cross-project evidence retrieval | 227 ms sequential |
| Single-project Q1 full answer | 11,247 ms |
| Single-project Q2 full answer | 3,576 ms |
| Single-project Q3 full answer | 4,847 ms |
| Cross-project full answer | 4,288 ms |

## 15. Token Usage

All answer token counts below came from the real Provider response and have `tokenUsageEstimated=false`.

| Call | Input | Output | Total |
| --- | ---: | ---: | ---: |
| Direct Provider probe | 44 | 136 | 180 |
| Single-project Q1 | 251 | 1,321 | 1,572 |
| Single-project Q2 | 251 | 519 | 770 |
| Single-project Q3 | 254 | 488 | 742 |
| Cross-project | 239 | 521 | 760 |

The No-Evidence request recorded `null` for input, output and total tokens. RAGFlow parsing separately reported 47 tokens for the Native Smoke document in the first measured run; that number is not presented as AI Gateway usage.

## 16. Bugs Found

1. Docker Hub was too slow for reliable pulls; the account ACR accelerator worked for cached images but returned not-found/server errors for several uncached RAGFlow dependencies.
2. Oracle's official MySQL image initializes only `root@localhost`, while upstream RAGFlow expects root access from the Compose network.
3. Enabling TEI after the initial RAGFlow start left the API container with stale `COMPOSE_PROFILES` and `TEI_MODEL`, so `Builtin` was not visible.
4. Project AI sent RAGFlow retrieval with `keyword=true`, which forces RAGFlow-internal Chat-model keyword extraction and failed with `No default chat model is set.`
5. RAGFlow v0.27 returns code 102 when `GET /datasets?id=...` or `name=...` has no match; Project AI treated the absence check as an exceptional provision failure.
6. Vinext local RSC could not read the configured absolute Secret File even though host permissions and ownership were correct.
7. Vinext/Miniflare development mode cancels Better Auth requests that resolve an authenticated Session cookie, reporting that the Worker would never generate a response. The build-generated standalone Node server succeeds against the same database and Session.
8. The first automated cross-project assertion required the English word `Shanghai`; the valid Chinese answer used `上海市`. Semantic validation passed without another paid model call.

## 17. Fixes Made

- Installed and verified Docker 29.7.2, switched the apt repository to Aliyun while retaining the official Docker GPG key, and configured the exact account ACR accelerator.
- Deployed RAGFlow v0.27.0 CPU with loopback-only bindings, an 8 GiB persistent Swap file, and a local TEI embedding model.
- Recreated only the RAGFlow API container after TEI enablement so the correct profile/model environment was loaded.
- Added `MYSQL_ROOT_HOST=%` for fresh initialization and restored the expected network-scoped root account on the existing POC MySQL volume without exposing the database publicly.
- Changed Project AI retrieval to `keyword=false`, keeping answer generation exclusively behind Project AI's AI Gateway.
- Changed Dataset lookup to enumerate accessible Datasets and perform exact local ID/name matching, making absence a normal idempotent provision state under v0.27.
- Added contract tests for both RAGFlow compatibility changes; 6 focused tests and TypeScript typecheck pass.
- Added sanitized health/configuration diagnostics that log only stage and controlled error code/type.
- Stored RAGFlow credentials only in root-only/server Secret files and a Git-ignored local `.env.local` required by the Vinext POC runtime.
- Built the application and ran the authenticated HTTP POC through `dist/standalone/server.js`, avoiding the Miniflare-only Session incompatibility without changing authorization behavior.
- Stored the user-supplied Qwen credential in a Git-ignored local Secret File with mode `0400`; no credential content was printed, logged, committed, copied to the RAGFlow server, or exposed to the browser.
- Enabled the Project AI AI Gateway only for this isolated local POC runtime and completed the real Provider, answer, Citation, No-Evidence and cross-project security checks.
- Re-ran the complete test suite under an explicit isolated test environment: 24/24 passed; ESLint, TypeScript typecheck and `git diff --check` also passed. The Live runtime remained healthy afterward.

## 18. Remaining Conditions

There is no remaining blocker in the required Live POC chain. Two conditions remain before treating this as a production-ready runtime:

1. Authenticated database-backed flows must use the build-generated standalone Node runtime until the Vinext/Miniflare development-mode Session cancellation is fixed and regression-tested.
2. Q1 used 1,321 output tokens and took 11.247 seconds. Production planning should add an explicit output-token limit and monitor answer latency/cost under a larger synthetic evaluation set.

The historical command `npm run knowledge:migrate-ragflow -- --dry-run --all` was not run. The task allowed at most a dry-run after the E2E gate; it did not require migration validation, and no historical data was migrated or deleted.

## 19. Final Decision

**GO WITH CONDITIONS**

The full real chain passed: authenticated Project AI HTTP API → project authorization → RAGFlow Dataset/Document mapping → upload → parse → retrieval → Evidence Guard → Project AI AI Gateway → real Qwen answer → validated Citation. No-Evidence avoided a Provider call, unauthorized project selection returned 404, and the real cross-project answer remained inside the authorized A+B boundary. The result uses no Fake RAGFlow, Fake Qwen or fabricated Citation.

This is a Live POC decision, not authorization to deploy Staging or Production. The standalone-runtime and latency/output-limit conditions above must be resolved or explicitly accepted before broader rollout.
