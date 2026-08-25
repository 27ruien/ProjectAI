# Staging Validation v1.1 Report

Validation date: 2026-08-25 (UTC)

## STAGING VALIDATION STATUS

**PASS WITH CONDITIONS**

The initial validation was blocked when the intentionally stopped RAGFlow ECS
lost its public IP. After the operator confirmed the replacement address, the
existing SSH Alias and existing systemd tunnel were updated from
`47.116.3.32` to `8.133.185.111` without changing or redeploying the Project AI
application. The exact immutable baseline then passed the resumed real
RAGFlow, Knowledge, Timeline, Weekly Report, authentication, authorization,
runtime, and Production-invariance checks described below.

### Initial validation history

- Initial Validation: **BLOCKED**
- Root Cause: **RAGFlow ECS intentionally stopped to reduce cost**
- Initial observation window: `2026-08-25T02:11:52Z` through
  `2026-08-25T02:15:25Z`

## RAGFLOW RECOVERY — FIRST ATTEMPT (BLOCKED)

Recovery attempt: `2026-08-25T02:41:38Z` through
`2026-08-25T02:47:35Z`, after the operator reported that the RAGFlow ECS had
been restarted.

| Check | Result | Evidence |
|---|---|---|
| `RAGFLOW_ECS_STATUS` | **FAIL** | The configured target did not complete an SSH handshake from the verifier, and the Staging host received TCP connection refusals. The operator-reported startup could not be independently confirmed. |
| Previous public IP | `47.116.3.32` | Recorded by the successful 2026-08-21 Live POC and still present in the local SSH Alias and existing Staging tunnel unit. |
| `CURRENT_IP` | **UNKNOWN** | The actual post-restart public and private IPs could not be queried because the instance was not SSH-reachable at the configured address. The available Aliyun console session was not authenticated. |
| IP changed | **UNCONFIRMED** | The old address is not usable from Staging, but no replacement address was guessed or written. |
| Docker daemon | **NOT_VERIFIABLE** | RAGFlow ECS SSH gate failed. |
| `RAGFLOW_CONTAINER_STATUS` | **NOT_VERIFIABLE** | Container state and RAGFlow container restart counts could not be collected without ECS access. |
| Internal listeners | **NOT_VERIFIABLE** | RAGFlow ECS local ports could not be inspected. |
| `RAGFLOW_INTERNAL_API_STATUS` | **NOT_VERIFIABLE** | The official local RAGFlow API could not be probed on the ECS. |
| `19380` listener | **FAIL** | No Staging listener was present after the recovery attempt. |
| Project AI to RAGFlow | **FAIL** | The live Project AI Dataset provision route returned HTTP `503` with controlled code `KNOWLEDGE_SERVICE_UNAVAILABLE`. |
| Real Dataset provision | **FAIL** | A real provision retry for the safe UAT Project A returned HTTP `503`; the verifier then logged out successfully. |

### Existing forwarding mechanism

- `FORWARDING_COMPONENT`:
  `projectai-slim-uat-ragflow-tunnel.service`
- Mechanism: the existing systemd-managed OpenSSH local tunnel; no `socat`,
  Docker forwarder, reverse proxy, or second tunnel was created.
- `UPSTREAM`: `root@47.116.3.32`, forwarding
  `172.17.0.1:19380` to RAGFlow-local `127.0.0.1:9380`.
- Service state: enabled and in `activating (auto-restart)`; no listener was
  established. `NRestarts=7110` is the systemd tunnel retry counter accumulated
  while the upstream was unavailable, not a RAGFlow container restart count.
- Recovery-window evidence: 74 tunnel `Connection refused` events were
  observed after `2026-08-25T02:40:00Z`.
- `RECOVERY_ACTION`: **NONE**. The existing service was already enabled and
  retrying automatically, so no redundant manual restart or new forwarding
  mechanism was introduced.
- `INFRASTRUCTURE_CHANGE`: **NONE**. No IP, unit, runtime environment, Nginx,
  Compose, application image, or source configuration was changed.

### Resumed connectivity gate

| Gate | Result |
|---|---|
| RAGFlow Core | **FAIL / NOT_VERIFIABLE** |
| `19380` Listener | **FAIL** |
| Staging App to RAGFlow | **FAIL** |
| Official RAGFlow API | **FAIL / NOT_VERIFIABLE** |
| Real Dataset Provision | **FAIL — HTTP 503** |

The connectivity gate did not pass. The mandated stop rule was applied again.
No Knowledge, Timeline, Weekly Report, external-Agent, Cross-Agent, or real-web
Skill execution was run after this result.

## RESUMED UAT RESULTS — FIRST ATTEMPT (NOT RUN)

| Area | Result | Reason |
|---|---|---|
| Knowledge retrieval / Evidence Guard / Qwen / Citation | **NOT_RUN — STOP RULE** | Real Dataset provision remained unavailable. |
| No-Evidence contract | **NOT_RUN — STOP RULE** | Connectivity prerequisite failed. |
| Unauthorized Project knowledge path | **NOT_RUN — STOP RULE** | Connectivity prerequisite failed; no prior deterministic test was substituted for live UAT. |
| Structured Timeline provider / persistence / permission | **NOT_RUN — STOP RULE** | The task explicitly requires Knowledge to be green first. |
| Weekly Report Execution Package / PLAN-ACTUAL / confirmation / override | **NOT_RUN — STOP RULE** | The task explicitly forbids running later Weekly Report checks to mask a RAGFlow failure. |
| Skill asset presence and versions | **UNCHANGED FROM INITIAL ARTIFACT CHECK** | Exact SHA and deployed image are unchanged; this is artifact evidence only, not Cross-Agent or real-web evidence. |

### Recovery runtime and Production safety

- Public health remained HTTP `200` with exact commit header
  `62d06e7184df9b43d72ad6780566d774b6f7255d` and app version
  `1.0.0-staging-validation-v1.1`.
- Slim UAT application and PostgreSQL remained healthy with restart count `0`.
- Recovery-window application critical-error keyword matches: `0`.
- Nginx configuration syntax check passed. A pre-existing conflicting
  `gridworks.cn` port-80 server-name warning remains; no Nginx configuration
  was changed.
- Production application remained healthy on the same image ID
  `sha256:a4b6d41941ebb8f995cf2ecaba65a595990187b8b93d03758287f42443cb5469`,
  original start time `2026-07-13T01:53:13.452401053Z`, and restart count `0`.
  No Production command other than read-only inspection was issued.

## RAGFLOW IP CHANGE

| Item | Result |
|---|---|
| Old IP | `47.116.3.32` |
| New IP | `8.133.185.111` |
| Root Cause | RAGFlow ECS was intentionally stopped and restarted; its public IP changed. |
| Infrastructure Change | RAGFlow connectivity / forwarding target updated to the new public IP. |
| Application Baseline Changed | **NO** |
| Application source/image redeployed | **NO** |

### Host identity and SSH

- The new address returned the same ED25519 Host Key fingerprint as the old
  address: `SHA256:H5ODeHweb1Ywc3CJHaRAhlqWMvp1Ir6yMyr3sPEWdNs`.
- The local `projectai-ragflow` Alias now resolves to `root@8.133.185.111`
  with the existing local identity and `IdentitiesOnly=yes`.
- The new verified Host Key was added without deleting the old Host Key.
- Batch SSH reached the original hostname `iZuf6439aqrzt692q9jcv1Z`; Aliyun
  instance metadata independently reported public IP `8.133.185.111` and
  private IP `172.27.96.181`.
- SSH result: **PASS**. `StrictHostKeyChecking` was not disabled or bypassed.

### RAGFlow ECS recovery

| Check | Result | Evidence |
|---|---|---|
| Docker daemon | **PASS** | Active; Docker Server `29.7.2`. |
| RAGFlow version | **PASS** | Existing `v0.27.0` image; no install or upgrade. |
| RAGFlow containers | **PASS** | RAGFlow, TEI, Elasticsearch, Valkey, MinIO/Silo, and MySQL all running. |
| Container restart count | **PASS** | All six containers reported restart count `0` after ECS boot. |
| Internal listeners | **PASS** | RAGFlow `9380`–`9384` and dependency ports remained loopback-bound; only SSH listened publicly. |
| Local official API | **PASS** | `GET /api/v1/system/healthz` returned HTTP `200`; DB, document engine, Redis, and storage all `ok`. |

The existing RAGFlow deployment auto-started successfully. No container,
database, image, RAGFlow version, or deployment file was changed.

### Existing 19380 tunnel recovery

- The only active forwarding component remained
  `projectai-slim-uat-ragflow-tunnel.service`.
- Its upstream was changed from `root@47.116.3.32` to
  `root@8.133.185.111`; the forwarding shape remained
  `172.17.0.1:19380 -> 127.0.0.1:9380`.
- Original unit and known_hosts files were preserved under
  `/srv/projectai-slim-uat/infra-backups/20260825T0257Z-ragflow-ip-change`.
- The existing service was daemon-reloaded and restarted. It remained
  `active (running)` with no post-recovery tunnel-error matches.
- `19380` Listener: **PASS**.
- Staging host to official RAGFlow API: **PASS**, HTTP `200`.
- Project AI container to official RAGFlow API: **PASS**, HTTP `200` through
  its unchanged `RAGFLOW_BASE_URL=http://host.docker.internal:19380`.
- Real Project A Dataset provision: **PASS**, HTTP `200`, status `ready`.

No `socat`, reverse proxy, second SSH tunnel, application environment change,
or source-code change was introduced.

## RECOVERED UAT FINAL RESULTS

Recovery/UAT observation window: `2026-08-25T02:56:11Z` through
`2026-08-25T03:04:04Z`.

### Connectivity gate

| Gate | Result |
|---|---|
| RAGFlow Core | **PASS** |
| `19380` Listener | **PASS** |
| Staging App to RAGFlow | **PASS** |
| Official RAGFlow API | **PASS** |
| Real Dataset Provision | **PASS** |

### Authentication and Project authorization

| Check | Result |
|---|---|
| admin login / repeated Session / logout | **PASS** |
| pm-a login / repeated Session / logout | **PASS** |
| pm-ab login / repeated Session / logout | **PASS** |
| admin Project scope A/B/C | **PASS** |
| pm-a Project scope A only | **PASS** |
| pm-ab Project scope A/B only | **PASS** |
| Unauthorized Project anti-enumeration | **PASS**; uniform HTTP `404` |

### Knowledge

| Check | Result | Evidence |
|---|---|---|
| Real Retrieval | **PASS** | Three accepted real RAGFlow chunks for the synthetic Project A acceptance question. |
| Evidence Guard | **PASS** | Returned Citations were bounded to locally mapped authorized documents. |
| Qwen Answer | **PASS** | Grounded answer returned `AURORA-7429` and `Lin Mei`. |
| Citation | **PASS** | Three Citations mapped to the authorized synthetic Project A source. |
| No Evidence | **PASS** | Contract-amount question returned `insufficient_evidence`, `answer: null`, and zero Citations. |
| Unauthorized Project | **PASS** | pm-a Project B project and ask routes returned uniform `404` without content, Citation, document, Dataset, or existence leakage. |

### Structured Timeline

| Check | Result | Evidence |
|---|---|---|
| Structured Provider | **PASS** | Live Weekly Report context returned `timeline.source=structured` and no Timeline document fallback. |
| Persistence / reload | **PASS** | Safe Project A snapshot saved and reloaded with matching data and incremented version. |
| Permission | **PASS** | pm-a Project A read returned `200`; Project B read/write returned `404`. |

### Weekly Report Context

| Check | Result | Evidence |
|---|---|---|
| Execution Package | **PASS** | Live authenticated context route returned finalized v1 package for Project A. |
| PLAN / ACTUAL separation | **PASS** | Structured PLAN retained `done`; same Daily Report fact retained explicit ACTUAL `未完成`. |
| Confirmation Gate | **PASS** | Ambiguous `Project AB` returned `needs_confirmation` with no Execution Package. |
| Unauthorized Override | **PASS** | pm-a override to Project B returned uniform `404` with no Project B detail. |

No external Agent was invoked. This result does not claim Weekly Report,
Timeline Maker, Requirement Analyst, or Feasibility Research Cross-Agent PASS.

### Skill assets

| Skill | Result | Version |
|---|---|---|
| Project Weekly Report | **PRESENT** | `1.2.0` |
| Project Timeline Maker | **PRESENT** | `0.1.0` |
| Project Requirement Analyst | **PRESENT** | `0.1.0` |
| Project Feasibility Research | **PRESENT** | `0.1.0` |

### Final runtime and conditions

| Observation | Result |
|---|---|
| Public exact-SHA health | **PASS**; HTTP `200`, exact commit and app-version headers |
| Application / PostgreSQL restarts | `0` / `0` |
| RAGFlow container restarts | `0` for all six containers |
| Post-recovery tunnel errors | `0` |
| Application critical errors | `0` |
| PostgreSQL errors | `0` |
| Nginx 5xx after recovery | `0` |
| Production fingerprint | **UNCHANGED**; healthy, original start time, restart count `0` |

Conditions retained for follow-up, without blocking this Staging baseline:

1. RAGFlow emitted eight request-time warnings while attempting to parse the
   valid API Key as JWT (`No b'.' found in value`). All associated real API
   operations succeeded; there was no Traceback, 5xx, restart, or Health
   degradation.
2. `nginx -t` passed but retained the pre-existing conflicting
   `gridworks.cn` port-80 server-name warning. No Nginx configuration was
   changed in this task.

## BASELINE

| Item | Result | Evidence |
|---|---|---|
| SHA | **PASS** | `62d06e7184df9b43d72ad6780566d774b6f7255d` |
| Tag | **PASS** | Annotated immutable tag `staging-validation-v1.1` peels to the exact SHA. |
| Branch | **PASS** | `refactor/project-ai-slim`; local, upstream, and remote branch head resolved to the exact SHA before deployment. |
| Branch CI | **SUCCESS** | GitHub Actions run `32712537099`, exact head SHA, completed successfully. |
| Tag CI | **SUCCESS** | GitHub Actions run `32712753945`, exact tag head SHA, completed successfully. |
| Predecessor tag | **UNCHANGED** | `staging-validation-v1` remained at its original object/peeled commit and was not moved. |
| Working tree before deployment | **CLEAN** | No tracked or untracked repository changes were present. |

CI validation is repository/build evidence. It is not counted as Staging
runtime or Cross-Agent UAT evidence.

## DEPLOYMENT

| Item | Result | Evidence |
|---|---|---|
| Target | **STAGING** | Isolated Compose project `projectai-slim-uat`, public base path `/tool/projectai-slim-uat`, loopback port `3102`. |
| Release identifier | **PASS** | `20260825T020158Z` |
| Source archive | **PASS** | Exact-SHA `git archive`; SHA-256 `8b3a370776ecc9398dbf0ea666bbc5a62ce0fa38da0c5a7385fca68d8f890362`. |
| Exact SHA deployed | **PASS** | Application image label, runtime environment, public health header, and exact source release agree on the baseline SHA. |
| Deployment method | **PASS** | Existing Slim Compose mechanism reused; only `projectai-staging` was recreated with `--no-deps`. |
| Application image | **PASS** | `projectai-slim-uat:20260825T020158Z-staging-validation-v1.1`; immutable local image ID `sha256:79fea6c5f6b649d9507b530747d76d854932c5d00cfbb2a691701ba905f1eed6`. |
| Image build metadata | **PASS** | Created `2026-08-25T02:03:02.751274679Z`; `org.opencontainers.image.revision` equals the exact SHA; environment `staging`; platform `linux/amd64`. |
| Container start | **PASS** | Started `2026-08-25T02:11:52.793806184Z`; healthy; restart count `0`. |

No commit, push, tag creation, tag movement, feature change, Skill change, or
Production deployment was performed.

### Database safety

- A protected PostgreSQL custom-format dump was taken before migration and
  passed `pg_restore --list` readability verification.
- The previous `.env.uat` was preserved as a protected backup.
- Only committed additive migrations `0035` and `0036` were applied. No
  migration was generated and no destructive schema operation was used.
- The Drizzle migration ledger advanced from 35 to 37 entries; the expected
  latest timestamp is `1787309413829`; both `project_aliases` and
  `project_timelines` are present.
- The exact-SHA db-tools image was used only for migration and then removed.
  It remains reproducible from the local exact-SHA image archive. Historical
  application and rollback images were not deleted.

### Disk observation

- Before remote image import: `4,019,416 KiB` available.
- After importing both images: `738,076 KiB` available.
- After the scoped removal of the just-imported db-tools image:
  `2,614,868 KiB` available.
- No global Docker prune, unrelated cache cleanup, historical image deletion,
  or Production resource cleanup was performed.

## ONLINE PROVENANCE

**PASS**

The public health request returned HTTP 200 with:

- `x-projectai-commit-sha: 62d06e7184df9b43d72ad6780566d774b6f7255d`
- `x-projectai-app-version: 1.0.0-staging-validation-v1.1`
- JSON health status `ok`

The running container uses image ID
`sha256:79fea6c5f6b649d9507b530747d76d854932c5d00cfbb2a691701ba905f1eed6`.
Its Compose working directory is
`/srv/projectai-slim-uat/releases/20260825T020158Z/source`, and its selected
non-secret runtime metadata contains the same exact SHA, build time, Staging
environment, version, and base path.

## INITIAL RUNTIME (BLOCKED ATTEMPT)

| Component | Result | Evidence |
|---|---|---|
| Application | **PASS** | Running, Docker health `healthy`, restart count `0`, public health HTTP 200. |
| PostgreSQL | **PASS** | Existing isolated UAT PostgreSQL container remained healthy, restart count `0`; committed migrations completed. |
| RAGFlow | **BLOCKED** | Real Dataset provision returned HTTP 503. The configured host forwarding port `19380` had no listener; direct HTTP connection was refused. |
| Reverse Proxy | **PASS** | Public base path served the exact health response; `nginx -t` succeeded. |

The separate RAGFlow host SSH endpoint closed the diagnostic connection. No
remote repair or credential inspection was attempted.

## INITIAL AUTH (BLOCKED ATTEMPT)

| Check | Result | Notes |
|---|---|---|
| Login | **PASS (bounded)** | The existing controlled Staging admin account authenticated and produced the expected secure session cookie before the RAGFlow request. No account was created. |
| Session persistence | **NOT_RUN — STOP RULE** | The verifier stopped during Dataset provision before the planned repeated session checks. |
| Logout | **NOT_RUN — STOP RULE** | The verifier stopped before the planned logout/revocation assertion. |
| Unauthorized request | **NOT_RUN — STOP RULE** | Not executed after the RAGFlow blocker. |

No password, Cookie, Session token, provider secret, or customer content is
included in this report.

## INITIAL PROJECT PERMISSION (BLOCKED ATTEMPT)

| Check | Result |
|---|---|
| Authorized Project | **NOT_RUN — STOP RULE** |
| Unauthorized Project / 404 anti-enumeration | **NOT_RUN — STOP RULE** |

The exact-SHA CI remains successful evidence for the authorization tests, but
it is not substituted for the unexecuted live permission UAT.

## INITIAL KNOWLEDGE / RAGFLOW (BLOCKED ATTEMPT)

| Check | Result |
|---|---|
| Real RAGFlow Retrieval | **BLOCKED** |
| Evidence Guard | **NOT_RUN — STOP RULE** |
| Qwen Answer | **NOT_RUN — STOP RULE** |
| Citation | **NOT_RUN — STOP RULE** |
| No Evidence | **NOT_RUN — STOP RULE** |
| Unauthorized Project | **NOT_RUN — STOP RULE** |

### Blocking issue: STG-V1.1-001

- Time observed: between `2026-08-25T02:11:52Z` and
  `2026-08-25T02:15:25Z`.
- Component: Staging RAGFlow connectivity / forwarding path.
- Symptom: `POST` to provision the authorized test Project Dataset returned
  HTTP 503.
- Read-only diagnosis: no listener on Staging host port `19380`; HTTP
  connection refused; the application itself stayed healthy with zero
  restarts.
- Disposition: **BLOCKED**. Restore the separately managed RAGFlow forwarding
  path under separate operational authorization, then rerun the stopped live
  checks without changing or moving this immutable tag. If a code change is
  required, use a new commit, CI run, and baseline tag.

## INITIAL STRUCTURED TIMELINE (BLOCKED ATTEMPT)

| Check | Result |
|---|---|
| Structured Provider | **NOT_RUN — STOP RULE** |
| Persistence / save-reload | **NOT_RUN — STOP RULE** |
| Project permission | **NOT_RUN — STOP RULE** |

The required schema is present after committed migration `0036`, but schema
presence is not reported as live Timeline UAT.

## INITIAL WEEKLY REPORT CONTEXT (BLOCKED ATTEMPT)

| Check | Result |
|---|---|
| Execution Package | **NOT_RUN — STOP RULE** |
| Structured Timeline source | **NOT_RUN — STOP RULE** |
| PLAN / ACTUAL separation | **NOT_RUN — STOP RULE** |
| Confirmation Gate | **NOT_RUN — STOP RULE** |
| Unauthorized Override | **NOT_RUN — STOP RULE** |
| Generic external-Agent Project Knowledge API unavailable | **CONFIRMED BY BASELINE ARTIFACT** | The deployed exact baseline has only the authenticated user-session cross-Project Q&A route; it does not add an Agent token, PAT, MCP server, or generic external-Agent API. |

No external Agent was invoked and no Cross-Agent result is claimed.

## SKILL ASSET PRESENCE

The exact-SHA build copied the `skills/` directory into the deployed image.
Versions and deterministic validator status are inherited from the successful
exact-head CI; no external or Cross-Agent run was performed here.

| Skill | Asset | Version | Runtime/UAT boundary |
|---|---|---|---|
| Project Weekly Report | **PRESENT** | `1.2.0` | Live package UAT not run after stop condition; Cross-Agent v1.2 remains `NOT_TESTED`. |
| Project Timeline Maker | **PRESENT** | `0.1.0` | Deterministic baseline only; Cross-Agent `NOT_TESTED`. |
| Project Requirement Analyst | **PRESENT** | `0.1.0` | Deterministic baseline only; Cross-Agent `NOT_TESTED`. |
| Project Feasibility Research | **PRESENT** | `0.1.0` | Deterministic baseline only; live search and Cross-Agent `NOT_TESTED`. |

## INITIAL LOGS (BLOCKED ATTEMPT)

Observation window: application start at `2026-08-25T02:11:52Z` through the
RAGFlow blocker diagnosis ending `2026-08-25T02:15:25Z`.

| Observation | Count / result |
|---|---|
| Startup critical-error keyword matches | `0` |
| Database error keyword matches | `0` |
| Auth/session error keyword matches | `0` |
| Unexpected application restarts | `0` |

The RAGFlow 503 was observed in the HTTP verifier and connection probe. Large
raw logs were not copied into this report.

## ROLLBACK READINESS

**PARTIAL**

- Previous deployed image remains present:
  `projectai-slim-uat:20260821T103512Z-ui-v1.1`, image ID
  `sha256:70d84e20e02c7880b1385794929959eaee238dca9abbef07744a5f6e8de7b330`.
- Previous environment file and a verified pre-migration PostgreSQL dump are
  protected on the Staging host.
- The prior application image can be selected through the existing manual
  Compose mechanism without touching Production.
- No destructive rollback test was run; therefore readiness is not promoted
  to `READY`.

The blocked exact-SHA application remains deployed and healthy for controlled
diagnosis. No automatic rollback was performed because the failing dependency
path is external to the application container and the task's failure policy
requires stopping rather than live repair.

## PRODUCTION INVARIANCE

**NOT TOUCHED**

Before and after the Staging deployment, the Production application retained
the same image ID, creation/start timestamps, healthy state, and restart count
`0`. No Production database access, migration, Compose action, Nginx change,
restart, secret operation, or deployment was performed. The older independent
Staging application and the Slim UAT PostgreSQL container likewise retained
their pre-deployment image/start fingerprints and restart count `0`.

## GROUND TRUTH UPDATED

**YES**

`PROJECT_AI_CURRENT_STATE.md` was updated only after the recovered real
Connectivity, Knowledge, Timeline, Weekly Report, authentication,
authorization, runtime, and Production-invariance checks completed. Production
itself remains outside the verified Staging scope.

## KNOWN LIMITATIONS

- Skill asset presence and versions are artifact/CI evidence, not Cross-Agent
  UAT.
- RAGFlow's successful API-Key requests currently emit a non-blocking JWT
  parsing warning; no 5xx, restart, or Health degradation was observed.
- Nginx retains a pre-existing conflicting port-80 server-name warning although
  `nginx -t` passes.
- Real WeCom OAuth, Production behavior, and all generic external-Agent,
  Workflow, Extension, MCP, PAT, Agent Runtime, and UI proposals remain outside
  this validation.

## RECOMMENDATION

**STAGING VALIDATED WITH CONDITIONS**

Retain the immutable `staging-validation-v1.1` baseline. Track the non-blocking
RAGFlow API-Key/JWT warning and the pre-existing Nginx warning separately; do
not treat this Staging validation as Production, Cross-Agent, or live-web
Feasibility Research validation.
