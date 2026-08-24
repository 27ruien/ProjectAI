# Project AI Slim dependency audit

Snapshot: `pre-slim-ragflow-migration` (`56bfec5`)

## Before metrics

| Metric | Full product snapshot |
| --- | ---: |
| Production source files | 484 |
| Production source LOC | 95,451 |
| API routes | 104 |
| Drizzle tables | 90 |
| Persistent application workers | 2 |
| npm dependencies | 28 |
| npm development dependencies | 23 |

## After metrics

| Metric | Slim working tree |
| --- | ---: |
| Production source files | 147 |
| Production source LOC | 13,455 |
| API routes | 15 |
| Active Drizzle table adapters | 14 |
| Persistent application job workers | 0 |
| npm dependencies | 16 |
| npm development dependencies | 22 |

The historical physical tables remain until the separately reviewed cleanup
migration. The Slim migration disables the old automatic knowledge-space
triggers so new Project and Document writes no longer populate legacy tables.

The source count covers JavaScript and TypeScript under `app`, `components`,
`lib`, `worker`, `scripts`, and `skills`. The two persistent workers are the
document ingestion worker and embedding worker. Product Map runs inside the web
application and is counted as application runtime, not as a separate worker.

## Dependency boundary

```text
KEEP
  Better Auth / Session / User
  Project / ProjectMember / centralized project authorization
  Drizzle / PostgreSQL
  minimal security audit
  provider-neutral AI Gateway and server-only provider credentials
  project and member UI

REPLACE
  project document storage + parsing + indexing + retrieval
    -> official RAGFlow HTTP API adapter
  assistant threads + conversation memory
    -> stateless project and cross-project knowledge queries

REMOVE FROM ACTIVE PRODUCT
  requirements / requirement overview / requirement documents
  scope / actions / risks / weekly report / daily timesheet
  Product Map / skills / workflows / agent experiments
  company knowledge / document ACL / knowledge-space UI
  model management / scenario binding / ordinary-user provider UI
  document worker / embedding worker / lexical, vector and RRF retrieval
```

## Import graph findings

- `lib/project-management/*` is used only by requirement, scope, action, risk,
  and weekly-report routes and tests. It has no required dependency from auth,
  projects, membership, or the AI Gateway.
- `lib/product-map/*` is used only by Product Map routes, UI, tests, and a Fake
  Provider branch. The Fake Provider can be made knowledge-only, allowing the
  entire Product Map domain to be removed.
- `lib/timesheets/*` and the WeCom extension are isolated from project and
  membership authorization.
- `lib/documents/processing`, `lib/ai/embeddings`, and `lib/ai/retrieval` form
  the self-built RAG chain. The only KEEP-side dependency is current file UI;
  replacing that UI/API with a RAGFlow-backed knowledge service removes the
  dependency.
- `project_documents` and `project_document_versions` are also the migration
  source for existing binaries. They must remain readable until the one-time
  RAGFlow migration succeeds. Old tables are therefore not dropped in the first
  migration even after active reads move to RAGFlow.
- Existing `knowledge_spaces` rows stay as rollback data, but Migration 0034
  removes the Project/Document creation triggers and the Slim application no
  longer imports or writes the table.
- `components/workspace.tsx` and the catch-all route are the active UI switch.
  Slim routing can be reduced to Projects, project Knowledge, and Members.

## RAGFlow contract

The pinned official stable release is `v0.27.0` (published 2026-08-19). Project
AI uses only these documented HTTP endpoints:

- `POST|GET|DELETE /api/v1/datasets`
- `POST|GET|DELETE /api/v1/datasets/{dataset_id}/documents`
- `POST /api/v1/datasets/{dataset_id}/chunks`
- `POST /api/v1/retrieval`

Project AI never connects to RAGFlow's MySQL, document engine, MinIO, or Redis.
Dataset IDs are resolved on the backend from authorized Project records and are
never accepted from browser requests.

## Database cleanup decision

Migration 0034 is additive: it adds Project-to-Dataset and
Document-to-RAGFlow mapping fields. Legacy business and self-built RAG tables
are stopped first, not dropped. A later cleanup migration requires row counts,
backup evidence, and a rollback plan after the RAGFlow migration is verified.
