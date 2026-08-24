# Weekly Report Eval Suite

This suite evaluates the current `project-weekly-report` Skill without comparing
an Agent response to a byte-for-byte Golden Markdown file.

## Structure

- `fixtures/`: synthetic Daily Report, Project, Timeline Plan, and bounded evidence.
- `cases/`: expected facts, forbidden claims, required sections, optional claims,
  evaluation notes, date allow-lists, capability restrictions, and canaries.
- `expected/`: the current Codex reference run. It is a semantic baseline, not an
  exact output snapshot.
- `helpers/`: Markdown parser and deterministic semantic checks.
- `weekly-report-eval.test.ts`: contract, negative-control, Timeline window,
  Project Match, capability, and multi-project regression tests.
- `run-eval.ts`: readiness command. It exits non-zero for reference failures or
  an unresolved Project Match finalization-gate finding.

## Run

```bash
NODE_ENV=test node --import tsx --test --test-concurrency=1 \
  tests/weekly-report-eval/weekly-report-eval.test.ts

NODE_ENV=test node --import tsx tests/weekly-report-eval/run-eval.ts
```

The first command verifies the suite and reference Agent run. The second is the
product-readiness gate and exits non-zero when a blocker is detected.

The WR-EVAL-09 Service gate also has a database-backed integration test. Run it
only against a migrated, isolated test database:

```bash
DATABASE_URL="$WEEKLY_REPORT_EVAL_DATABASE_URL" NODE_ENV=test \
  node --import tsx --test --test-concurrency=1 \
  tests/weekly-report-eval/service-gate-integration.test.ts
```

## Evaluate another Agent

1. Give the Agent the current execution package, including the embedded Skill.
2. Record the final Markdown and every Project capability request.
3. Create an `AgentEvalRun` for each Case; use `markdown: null` and
   `finalized: false` for an unresolved ambiguous Project.
4. Call `evaluateWeeklyReportRun(case, run)`.

Do not give the external Agent generic Knowledge, document-listing, or RAGFlow
query tools. The capability trace is part of the Eval evidence.
