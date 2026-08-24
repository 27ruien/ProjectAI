# Timeline Maker Contracts v0.1

## Structured Draft

The Draft is provider-neutral and precedes persistence:

- `schemaVersion`: `projectai-timeline-maker-draft-v1`
- `skillId`: `project-timeline-maker`
- `skillVersion`: `0.1.0`
- `title`
- `mode`: `create_draft` or `propose_update`
- `existingTimelineVersion`: null for create; reviewed positive version for update
- `language`: `zh` or `en`
- `requirements[]`: ID, domain, label, status, evidence, reason
- `phases[]`: name, basis, basis detail
- `tasks[]`: Workbench fields plus basis references
- `assumptions[]`: ID, statement, affected Task IDs
- `warnings[]`

Draft basis is `confirmed`, `requirement_gap`, or `inferred`. A gap Task must
reference a Requirement ID. An inferred Task must reference an Assumption ID.
The adapter removes Draft-only provenance before producing Workbench Snapshot
data; no database migration is required.

## Tool capability contract

Allowed read/write intents are:

- `get_project_timeline(projectId)`
- `create_timeline_draft(projectId, expectedTimelineVersion=null, draft)`
- `propose_timeline_update(projectId, expectedTimelineVersion, draft)`

The server must authenticate the user, authorize the exact Project, validate
the Draft, and reject stale versions. These are draft/proposal capabilities,
not direct persistence. Never expose raw `data_json`, database schema, RAGFlow,
or internal storage fields.

## Markdown fallback

The fixed section order is:

1. `# Project Timeline`
2. metadata table
3. `## Requirement Check`
4. `## Phases`
5. `## Planning Assumptions`
6. `## Warnings`
7. `## Timeline Draft`

Use `/` for empty values and `<br>` for lists. Dates are `/` or `YYYY-MM-DD`.
Status is `incomplete` or `done`; basis is `confirmed`, `requirement_gap`, or
`inferred`. The Timeline table is:

```text
| Task ID | 阶段 | 任务 | 负责人 | 开始日期 | 结束日期 | 状态 | 依据 | Requirement IDs | Assumption ID | 依据说明 |
|---|---|---|---|---|---|---|---|---|---|---|
```

The deterministic parser validates this contract and maps the first seven
Workbench fields (`Task ID` through `状态`) to the existing Snapshot. It does
not call AI and does not save anything.
