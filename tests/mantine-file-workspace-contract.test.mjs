import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Mantine is the active shell with the restrained blue theme", async () => {
  const [layout, shell, theme] = await Promise.all([
    source("app/layout.tsx"),
    source("components/layout/app-shell.tsx"),
    source("theme/project-theme.ts"),
  ]);
  assert.match(layout, /MantineProvider/);
  assert.match(shell, /AppShell as MantineAppShell/);
  assert.match(theme, /#4058D6/i);
  assert.match(theme, /#3448B8/i);
  assert.match(theme, /#2D3D98/i);
});

test("project files use folders, stable viewer links and the four-item action contract", async () => {
  const [workspace, schema, migration, route, workflow] = await Promise.all([
    source("components/project/ProjectFileWorkspace.tsx"),
    source("lib/db/schema/project-documents.ts"),
    source("drizzle/0032_mantine_file_workspace.sql"),
    source("app/[...slug]/page.tsx"),
    source(".github/workflows/ci.yml"),
  ]);
  for (const label of ["分享", "复制链接", "创建副本", "删除"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /新建文件夹/);
  assert.match(workspace, /FOLDER_NOT_EMPTY|仅空文件夹/);
  assert.match(workspace, /documentViewerPath/);
  assert.match(workspace, /sortKey/);
  assert.match(workspace, /folderId/);
  assert.match(workspace, /搜索是项目范围/);
  assert.match(schema, /projectDocumentFolder/);
  assert.match(migration, /project_document_folders/);
  assert.match(route, /child === "artifacts"/);
  assert.match(route, /\/files/);
  assert.match(workflow, /npm run test:file-workspace/);
  assert.match(workflow, /npm run test:file-workspace-integration/);
});

test("delete, duplicate and preview remain server-authorized and fail closed", async () => {
  const [documents, preview, textPreview] = await Promise.all([
    source("lib/files/document-service.ts"),
    source("app/api/projects/[projectId]/documents/[documentId]/versions/[versionId]/preview/route.ts"),
    source("lib/files/text-preview.ts"),
  ]);
  assert.match(documents, /DOCUMENT_HAS_FORMAL_REFERENCES/);
  assert.match(documents, /deleteScopedRows/);
  assert.match(documents, /\.delete\(projectDocument\)/);
  assert.match(documents, /requirement_sources/);
  assert.match(documents, /focused_requirement_citations/);
  assert.match(documents, /action_item_sources/);
  assert.match(documents, /risk_sources/);
  assert.match(documents, /guided_requirement_overview_citations/);
  assert.match(documents, /sourceDigest !== currentVersion\.sha256/);
  assert.match(documents, /document_duplicated/);
  assert.match(preview, /requireProjectDocumentVersionResource/);
  assert.match(preview, /"view"/);
  assert.match(textPreview, /label: "utf-8"/);
  assert.match(textPreview, /label: "gb18030"/);
  assert.match(textPreview, /new TextDecoder\(candidate\.label, \{ fatal: true \}\)/);
});

test("the viewer separates original-file preview from AI extraction", async () => {
  const viewer = await source("components/document-viewer/DocumentViewer.tsx");
  assert.match(viewer, /pdfjs-dist/);
  assert.match(viewer, /renderAsync/);
  assert.match(viewer, /DOCUMENT_SERVER_NOT_CONFIGURED/);
  assert.match(viewer, /AI 抽取与向量索引不参与版式渲染/);
  assert.match(viewer, /rehypeSanitize/);
});

test("requirement overview regeneration creates lineage and saves only explicitly", async () => {
  const [service, ui, schema, migration] = await Promise.all([
    source("lib/focused-mvp/requirement-overview.ts"),
    source("components/requirement-overview/RequirementOverviewWorkspace.tsx"),
    source("lib/db/schema/ai-model-management.ts"),
    source("drizzle/0032_mantine_file_workspace.sql"),
  ]);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /basedOnOverviewId/);
  assert.match(service, /Choosing a candidate creates an editable, versioned draft only/);
  assert.doesNotMatch(service, /REQUIREMENT_ALREADY_GENERATED/);
  assert.match(ui, /重新生成/);
  assert.match(ui, /基于当前版本继续编辑/);
  assert.match(ui, /另存为新版本/);
  assert.match(ui, /Every generation click reserves a new immutable overview version/);
  assert.match(schema, /basedOnOverviewId/);
  assert.match(migration, /based_on_overview_id/);
});
