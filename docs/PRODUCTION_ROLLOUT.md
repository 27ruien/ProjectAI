# Guarded Production Rollout Executor

## B3-C2A boundary

B3-C2A develops and rehearses the Production rollout executor. It does not execute a Production rollout, deploy Production or Staging, create a Production data plane, create a Qwen Secret, or authorize B3-C2B. C1 requirements, C2 Scope comparison, D Action/Risk/Weekly Report, Rerank, ANN, OCR, Tool Calling, and Agent Execution remain frozen.

Formal Production rollout is a later B3-C2B operation against an independently reviewed and merged main commit. The default state is fail-closed: no formal Authorization exists, `productionRolloutAuthorized` remains false in B3-C1 Go/No-Go evidence, and Production `--apply` without an independently signed Authorization exits with `PRODUCTION_APPLY_NOT_AUTHORIZED` and code 78.

## Authorization

The versioned schema is `release/production-rollout-authorization.schema.json`. The producer is `projectai-release-tool`, version `b3-c2-v1`. A formal Authorization is bound to one Release Session, Candidate SHA, App image digest, db-tools image digest, Production baseline digest, Go/No-Go digest, expiry, and explicit Phase set.

Formal `production-approval` records require an Ed25519 signature verified with an operator-controlled public key. B3-C2A cannot generate a formal Authorization. Unit tests and isolated rehearsals use only short-lived `synthetic-test` Authorization and ephemeral keys. Recomputing a JSON Digest or writing `productionRolloutAuthorized=true` cannot forge the signature.

Authorization lifetime is at most 60 minutes. Expired, mismatched, synthetic, unsigned, out-of-scope, or baseline-drifted Authorization fails closed with a controlled error code.

## Phase execution

Every Phase is a separate command and produces a separate digest-pinned report:

```bash
npm run production:phase -- --phase=0 --environment=production --dry-run ...
npm run production:phase -- --phase=0 --environment=production --apply ...
```

There is no command that automatically promotes Phase 0 through Phase 6. Apply requires the exact Session, Authorization, Manifest, Production baseline/current Inventory, Go/No-Go, Candidate SHA/Image, and current Container/Image. Phase 1–6 additionally require the previous generated successful Phase report.

The fixed sequence is:

1. Phase 0 — baseline, deployment/migration locks, capacity, Nginx/Compose, public HTTP, configuration backup, and applicable data backup.
2. Phase 1 — private PostgreSQL 17/pgvector 0.8.1 and MinIO bootstrap, private bucket initialization, and controlled migrations.
3. Phase 2 — immutable App and Document Worker with Assistant/Embedding disabled and lexical retrieval.
4. Phase 3 — operator-prepared Qwen Secret metadata verification and Assistant lexical enablement.
5. Phase 4 — Embedding Worker, bounded first batch of at most 100 Chunks, and budget/unknown checks.
6. Phase 5 — Shadow retrieval with lexical Prompt evidence and at least 30 controlled requests or the reviewed observation window.
7. Phase 6 — Hybrid retrieval with citation, fallback, isolation, archive/current-version, latency, and cost verification.

The formal observation defaults are never zero: Phase 2 is 15 minutes, Phase 3 is 30 minutes, Phase 4 is the first 100 Chunks plus 30 minutes, and Phase 5/6 require at least 30 controlled requests and 30 minutes. Rehearsal may shorten elapsed time while testing the same non-zero gate logic.

## Lock and journal

The fixed Production lock is `/srv/projectai/.production-rollout-lock`. It is atomically created as a regular `0600` file and binds Session, Candidate SHA, Phase, PID, hostname, start, and expiry. Existing or uninterpretable locks are never overwritten automatically. A stale timestamp alone is not authority to delete a lock.

The append-only Journal is `/srv/projectai/releases/<release-session-id>/journal.jsonl`. Each event carries the previous Digest and its own Digest. History is never rewritten. The allowed states are `not_started`, `authorized`, `running`, `succeeded`, `failed`, `rolled_back`, `rollback_failed`, and `blocked`; invalid transitions fail closed.

`npm run production:status` is read-only and reports only sanitized runtime identity, Phase state, lock metadata, latest report Digests, active counts, feature modes, and rollback availability. `npm run production:resume` reconstructs state from the Lock, Journal, Session, Manifest, Inventory, current runtime, and prior Phase report. Ambiguity returns `PRODUCTION_ROLLOUT_STATE_UNKNOWN`.

## Compose and Secret boundary

`docker-compose.production-rollout.yml` is the reviewed base contract. `docker-compose.production-ai.yml` is the Phase 3+ Qwen mount override. PostgreSQL and MinIO publish no host ports. Images are immutable, services are resource bounded and health checked, and `docker compose down` is forbidden.

The App receives database, auth, object-storage application credentials, and Phase-appropriate AI configuration. The Document Worker receives database/object credentials but no Qwen or MinIO root credentials. The Embedding Worker receives database/Embedding/Qwen configuration but no object credential. Migration receives only database configuration. MinIO Init receives root and application credentials only for the short-lived initialization task.

The Qwen Secret is prepared independently in B3-C2B. The executor checks only existence, regular-file/non-symlink status, owner/group identifiers, permission mode, non-empty size, and mount scope; it does not print or copy the content. Phase 0–2 do not require the Qwen Secret. Phase 3 without safe metadata stops with `PRODUCTION_QWEN_SECRET_REQUIRED`.

## Image and switch contract

Release images are built locally from the exact reviewed Git SHA for `linux/amd64`, saved and checksummed, transferred without floating tags, loaded on the server, and re-inspected. App and db-tools identity must match their immutable Digests; App labels must contain the exact revision and `com.projectai.release.environment=production`; OS/architecture must be `linux/amd64`.

`npm run production:image -- plan|build|verify|transfer` implements this contract. Transfer Apply independently requires the signed Phase 0 Authorization, both archive SHA-256 values, and `PROJECTAI_PRODUCTION_IMAGE_TRANSFER_ENABLED=1`; after transfer it verifies both checksums and re-inspects both loaded images for Digest, OS, architecture, revision, and Production label. B3-C2A never enables it.

Phase 2 does not run `docker compose down`. It starts the healthy private data plane first, loads the immutable App, verifies the old baseline has not drifted, replaces only the App/Document Worker, and immediately checks local health and public HTTP. The old image is retained through verification and restored immediately on failure.

## Rollback

- Phase 0 releases its owned lock and retains reports/backups.
- Phase 1 stops only the newly introduced data services and preserves volumes for investigation; the old public App remains untouched.
- Phase 2 restores the exact old App image/runtime and verifies HTTP 200.
- Phase 3 disables Assistant and removes the App Qwen mount on rebuild.
- Phase 4 disables Embedding, stops the Embedding Worker, and preserves vectors.
- Phase 5 and 6 return retrieval to lexical.

Every rollback produces a report and Journal event, verifies public/core behavior, and never deletes business data.

## Rehearsal and evidence

`npm run production:rehearsal` uses an isolated Compose project, internal network, isolated volume, Fake Provider semantics, fictional data, an ephemeral test key, and no public ports. It exercises Phase 0–6, authorization expiry/scope/bindings, held locks, Journal/Resume, failure/rollback gates, Compose/Secret/Image contracts, and cleanup.

CI publishes the following sanitized reports with file and payload Digests: `production-authorization-contract`, `production-phase-state-machine`, `production-rollout-rehearsal`, `production-rollout-rollback`, `production-rollout-resume`, `production-compose-contract`, and `production-secret-boundary`. Reports never contain Secret values, full environment variables, database contents, object keys, user data, Prompt/questions, vectors, or Provider payloads.
