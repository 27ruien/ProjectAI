# Project Weekly Report Skill PoC

## Boundary

Project AI owns the portable Skill asset, authenticated project scope,
deterministic project matching, bounded Timeline Context/Knowledge retrieval,
and the execution package. It does not generate the weekly report and does not
run an Agent. Codex, Claude, GPT, DeepSeek, Qwen, Gemini, or another
Markdown-capable Agent consumes the package and follows the embedded
`SKILL.md`.

No Weekly Report page, Extension UI, Workflow Engine, Registry Runtime, or
Agent Harness is added by this PoC.

## Execution flow

```text
Authenticated employee
  -> upload one CSV/XLSX daily report + week range
  -> parse header aliases and normalize facts
  -> load only server-authorized Projects
  -> official-name exact -> alias exact -> weighted fuzzy match
  -> leave ambiguous/unmatched labels unresolved
  -> load structured Timeline through the internal provider
  -> otherwise retrieve the external Timeline document fallback
  -> calculate bounded this-week/next-week plans and milestones
  -> retrieve relevant non-Timeline Knowledge by Project ID
  -> guard every RAGFlow result by Dataset ID + Document ID
  -> load current skills/project-weekly-report/SKILL.md
  -> return versioned JSON execution package
  -> external Agent returns one raw UTF-8 Markdown title and six-column table
```

The endpoint does not call the Project AI AI Gateway. Timeline, Knowledge, and
daily-report text are passed as untrusted facts, not executable instructions.

## Data model

- `project_aliases`: durable `normalized alias -> project_id` mapping with
  creator and timestamp. The same normalized alias may exist for different
  Projects, so collisions remain confirmable rather than silently global.
- `project_documents.context_kind`: classifies a Project document as `general`,
  `timeline`, `meeting_notes`, `scope`, `proposal`, `requirement`,
  `test_report`, or `project_brief`.
- Existing Project, ProjectMember, RAGFlow Dataset/Document mapping, and Audit
  tables remain the authority for access and evidence.
- `ProjectTimelineContext` is a provider-neutral internal contract. It carries
  `source`, bounded phases/tasks, `plannedThisWeek`, `plannedNextWeek`, and
  deterministic milestones without exposing storage rows to Weekly Report.

Migration `0035_fresh_alex_wilder.sql` is additive. It does not drop or rewrite
legacy tables. The structured Timeline integration adds no migration.

## API

### Get the current Skill

```http
GET /api/skills/project-weekly-report
```

Requires an authenticated Project AI session. The response includes the full
main Skill Markdown plus repository-derived metadata and content type. It uses
the same controlled official Skill distribution contract as `GET /api/skills`;
references and directory contents are not returned. The Extension may cache
this portable Skill in `chrome.storage.session`, but not in long-lived local
storage.

### Build an execution package

```http
POST /api/skills/project-weekly-report/context
Content-Type: multipart/form-data
```

Form fields:

- `dailyReport`: one `.csv` or `.xlsx` file, maximum 10 MB;
- `weekStart`: inclusive `YYYY-MM-DD`;
- `weekEnd`: inclusive `YYYY-MM-DD`, with a total range of 1–7 days;
- `matchOverrides`: optional JSON array of
  `{ sourceProjectName, projectId, saveAlias }`.

The POST route requires an authenticated session and a trusted Origin. An
override can only target a Project already in the user's authorized Project
set. `saveAlias=true` additionally requires Project edit permission.

Example adapter request:

```js
const form = new FormData();
form.append("dailyReport", file);
form.append("weekStart", "2026-08-17");
form.append("weekEnd", "2026-08-21");
form.append("matchOverrides", JSON.stringify([
  {
    sourceProjectName: "茶姬 VF",
    projectId: "PRJ_000123",
    saveAlias: true,
  },
]));

const response = await fetch("/api/skills/project-weekly-report/context", {
  method: "POST",
  body: form,
});
```

If the first response contains `needs_confirmation`, the adapter should show
the returned candidates, collect an explicit selection, and resubmit with
`matchOverrides`. It must never select a candidate on the user's behalf.

## Deterministic matcher

Normalization applies Unicode NFKC, lowercase, whitespace and punctuation
removal, and removal of a trailing `项目` or `Project`. Matching order is:

1. normalized official name exact match;
2. normalized alias exact match;
3. optional explicit override;
4. `fast-fuzzy` name similarity plus centralized business weights:
   name 60, membership 20, active state 10, recent use 10.

Score 85 or above is auto-matched only when the leading candidate is at least
8 points above the runner-up. Score 70–84 or an ambiguous high score requires
confirmation. Lower scores remain unmatched. Only authorized Projects are ever
candidates.

## Context selection

Timeline source order is fixed:

1. a structured Timeline returned by the internal provider;
2. bounded evidence from an external Timeline document;
3. `source=none` with empty milestones.

When structured Timeline exists, the Timeline document retrieval callback is
not called. Other ready documents form the relevant Knowledge pool, so Timeline
documents do not consume general Knowledge context. Every fallback evidence
item is still constrained to the backend-resolved Dataset and authorized local
Document IDs.

The deterministic builder shifts the reporting interval by seven days for the
next-week window and applies inclusive overlap, so a task crossing both weeks
appears in both planned lists. Only the bounded union of current/next tasks and
up to eight current/future milestones is sent to the Agent. Ordinary far-future
tasks are omitted. Milestone classification is centralized: an existing
milestone/phase/key-task marker wins, followed by the small reviewed name-rule
allow-list.

Per Project, the package carries at most eight evidence items and 12,000
characters, 16 planned tasks per reporting window, and eight milestones.
Timeline and Knowledge failures are isolated per Project. Missing Timeline or
Knowledge does not fail the package; warnings tell the external Agent to use
`/` for unsupported milestones.

`dailyReport.facts` is ACTUAL evidence. Timeline tasks are PLAN evidence and
cannot establish completion. Project `status` and `stage` remain unchanged;
Timeline `currentPhase` is a separate planning signal.

## Structured provider boundary

The audited Project AI repository does not currently contain a persisted
Timeline table, Project association, or authorized Timeline read repository.
The separate Timeline Workbench has the reusable task shape and Excel
import/export behavior, but stores no Project-linked server record. Therefore
this change introduces the provider contract and complete priority/context
logic without inventing a parallel database schema. Until a real Project AI
Timeline persistence adapter implements `StructuredTimelineRepository`, the
default provider returns no structured record and existing Timeline documents
continue to serve as fallback.

## Adapter use

The intended employee flow is:

```text
Open a future Project AI adapter or Extension
  -> choose Generate Weekly Report
  -> upload this week's daily report
  -> confirm ambiguous Project matches
  -> send the returned execution package to the selected external Agent
  -> download weekly-report-YYYY-MM-DD.md when supported
  -> otherwise copy the complete raw Markdown report
  -> import it into Feishu Docs
```

The current repository implements the reusable backend and Skill asset only;
the Extension adapter remains future work.
