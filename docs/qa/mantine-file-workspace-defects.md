# Mantine File Workspace Defect Register

## Confirmed baseline defects

| ID | Severity | Defect | Baseline evidence | Target disposition |
| --- | --- | --- | --- | --- |
| MFW-001 | P1 | Global breadcrumb exposes the internal project UUID | Staging `/data-spaces/projects/:id/files` DOM snapshot | fix and regress |
| MFW-002 | P1 | Project detail still exposes the AI-generated-document tab | Staging project tablist | remove route surface, preserve data |
| MFW-003 | P1 | File names and version labels are not openable links | Staging project files table | unified viewer links |
| MFW-004 | P1 | File row menu exposes unrelated lifecycle/debug actions | Staging file action menu | keep four requested actions |
| MFW-005 | P0 | Permanent delete depends on a dynamic `project_id + document_id` sweep and misses restrictive source/citation foreign keys | service and schema audit | explicit dependency plan plus storage reconciliation |
| MFW-006 | P1 | Text/Office preview uses the raw download surface and can render extracted/binary content as unreadable text | UI and download-route audit | original-object viewer adapters |
| MFW-007 | P1 | Requirement overview selection automatically occupies the generated state and persists an artifact | service audit | derived versions and explicit publish |
| MFW-008 | P1 | Staging cannot safely host ONLYOFFICE with 2 CPUs, 3.5 GiB RAM, no swap, and 2.37 GiB free disk | read-only host inventory | feature-gated adapter and bounded fallback |

All destructive browser checks use generated test data only. Existing project files,
conversations, artifacts, providers, and the unmanaged Staging orphan container are
outside the deletion scope.
