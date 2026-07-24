# Product V2 Staging UAT

This runbook is Staging-only. It must never be pointed at `/srv/projectai`, the Production compose project, Production URL, Production database, or Production object storage.

## Release gate

Before deployment:

1. The branch is exactly `agent/projectai-product-architecture-v2` and the worktree contains no ProjectAI changes.
2. Local Head equals `origin/agent/projectai-product-architecture-v2` and exact-head CI is green.
3. The existing Staging lock and Product V2 marker are absent or have been manually reviewed.
4. Protected Staging auth, AI, embedding, and Qwen secret files are regular non-symlink files with mode 600. Values are never printed.
5. Production is checked read-only before and after the operation and must remain unchanged.

Run the dedicated deployer:

```bash
./scripts/deploy-product-v2-staging.sh
```

The deployer creates and validates a PostgreSQL custom dump and protected configuration backups before synchronizing the release tree. It then applies committed migrations through 0023, runs insert-only Product V2 Seed, starts the immutable App/Worker image with AI disabled, executes the real Qwen provider probe, recreates only the Staging App with AI enabled, and runs the sanitized Product V2 smoke. Failure enters the Staging-only database/config/image recovery path. It never runs a Production command.

## Required browser gates

Run each gate against the fixed public Staging target. No trace or video is recorded; screenshots contain fictional content only.

```bash
export ALLOW_STAGING_PRODUCT_V2_UAT=true
npm run test:staging:auth
npm run test:staging:navigation
npm run test:staging:organization
npm run test:staging:knowledge
npm run test:staging:knowledge-permissions
npm run test:staging:ai-retrieval-permissions
npm run test:staging:ai-workflow
npm run test:staging:daily-report
npm run test:staging:global-search
```

The tests use browser UI actions for department creation/edit/move, project-space creation, member view/edit/revoke, file upload/preview, cited real-AI query, Requirement Extraction upload/generate/edit/batch approval/save, and navigation/search. API calls are limited to login setup, security assertions, ingestion observation, and cleanup; they do not substitute for the product actions under acceptance.

## Evidence and stop conditions

Evidence is written under ignored `test-results/product-v2-staging/evidence/`. It must not include cookies, Session tokens, provider payloads, prompts, customer content, environment files, database dumps, object keys, or credentials.

Stop and retain the Draft PR if any of the following occurs:

- exact deployed Head differs from the PR Head;
- Mock WeCom is unavailable on Staging or appears available under Production configuration;
- migration/seed/smoke or a browser gate fails after at most three scoped repair cycles;
- a Member can see an ungranted space, project, document, AI citation, or another user's private thread;
- Requirement Extraction returns a non-200 success contract, persists an unreviewed formal requirement, or loses the temporary attachment lifecycle;
- real Qwen is not configured, no citation is produced from the fictional authorized document, or evidence is synthetic;
- Production read-only state differs before and after Staging work.

Passing local tests or Mock AI is not equivalent to Staging real-AI acceptance. The PR stays Draft until current-head CI, all nine browser gates, Reviewer approval, and the PR evidence summary are complete.
