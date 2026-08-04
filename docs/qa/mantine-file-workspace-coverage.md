# Mantine File Workspace Coverage Map

This document is the live acceptance map for the Mantine, project file workspace,
document viewer, and requirement overview versioning change.

## Functional coverage

| Area | Contract | Primary evidence |
| --- | --- | --- |
| Mantine shell | Mantine theme, AppShell, notifications, responsive navigation | component tests, browser desktop/mobile |
| File workspace | folders, breadcrumbs, search, sorting, list/grid preference | API tests, browser happy path |
| File actions | share, copy link, duplicate, delete are the only list actions | service tests, browser menu inspection |
| Delete integrity | database dependents, chunks, vectors, previews, objects are reconciled | transaction tests, object-storage tests |
| Viewer | authenticated immutable-version route and format adapters | viewer tests, browser file-open checks |
| Text encoding | strict UTF-8, UTF-8 BOM, GB18030, invalid bytes rejected | encoding tests |
| Citations | open the viewer with page/slide/sheet/range/line/heading metadata | citation tests, browser path |
| Navigation | project name replaces internal IDs; AI document tab removed | route tests, browser breadcrumbs |
| Requirement overview | repeated generation creates a new version; explicit save publishes | service/API tests, two-run browser path |
| Provider models | credential masking, ACL, model/profile pages remain usable | provider regression, browser admin path |

## Role coverage

| Role | Read/open | Upload | Folder manage | Duplicate | Delete | Provider admin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| System administrator | yes | yes | yes | yes | yes | yes |
| Organization administrator | yes | yes | yes | yes | yes | yes |
| Project manager | yes | yes | yes | yes | yes | no |
| Project member | yes | yes | no | no | no | no |
| Viewer | yes | no | no | no | no | no |
| Unauthorized user | no | no | no | no | no | no |

## Browser path

1. Open a project and verify the project name in both breadcrumb layers.
2. Create a folder and a nested folder, navigate with breadcrumbs, and reject a cycle.
3. Upload UTF-8 Markdown, PDF, DOCX, XLSX, and PPTX test files.
4. Open names, icons, and versions through the immutable viewer route.
5. Verify Markdown encoding, PDF navigation, DOCX fallback, and Office unavailable states.
6. Sort by name, created time, updated time, owner, and type.
7. Exercise share, copy link, duplicate, and delete; confirm all derived rows and objects.
8. Generate two requirement overview versions, edit a derived version, and explicitly save it.
9. Verify `/admin/models` retains credential masking and administrator-only access.
10. Repeat the essential file flow at a narrow viewport.
