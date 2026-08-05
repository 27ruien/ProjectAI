import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (file) => readFile(new URL(file, root), "utf8");

async function sourceFiles(directory) {
  const base = new URL(`${directory}/`, root);
  const entries = await readdir(base, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => entry.isDirectory() ? sourceFiles(`${directory}/${entry.name}`) : /\.(?:ts|tsx|css)$/u.test(entry.name) ? [[`${directory}/${entry.name}`, await readFile(new URL(entry.name, base), "utf8")]] : []));
  return nested.flat();
}

test("shadcn is the only business UI system and uses the b1YmqwF5U preset", async () => {
  const [layout, globals, packageJson, appFiles, componentFiles] = await Promise.all([
    source("app/layout.tsx"), source("app/globals.css"), source("package.json"), sourceFiles("app"), sourceFiles("components"),
  ]);
  const businessSource = [...appFiles, ...componentFiles].map(([file, contents]) => `${file}\n${contents}`).join("\n");
  assert.doesNotMatch(businessSource, /@mantine\//u);
  assert.doesNotMatch(layout, /MantineProvider/u);
  assert.doesNotMatch(packageJson, /@mantine\//u);
  assert.match(layout, /AppearanceProvider/u);
  assert.match(layout, /<TooltipProvider>/u);
  assert.match(layout, /components\/ui\/sonner/u);
  for (const token of [
    "--primary: oklch(0.488 0.243 264.376)",
    "--sidebar-primary: oklch(0.546 0.245 262.881)",
    "--radius: 0.625rem",
    ".dark",
    "--background: oklch(0.145 0 0)",
    "--sidebar-primary: oklch(0.623 0.214 259.815)",
  ]) assert.match(globals, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  assert.doesNotMatch(`${globals}\n${businessSource}`, /20ae9f|4058d6|3448b8|2d3d98|mantine-color|mantine-radius/iu);
});

test("native file inputs stay visually hidden behind upload dropzones", async () => {
  const componentFiles = await sourceFiles("components");
  for (const [file, contents] of componentFiles) {
    for (const tag of contents.matchAll(/<input\b[^>]*type=["']file["'][^>]*>/giu)) {
      assert.match(tag[0], /hidden|sr-only/iu, `${file} exposes a native file input`);
    }
  }
  const company = await source("components/knowledge/CompanyKnowledgePage.tsx");
  const primitives = await source("components/ui/project-primitives.tsx");
  assert.match(company, /<Dropzone/u);
  assert.doesNotMatch(company, /TextInput[^>]+type="file"/u);
  assert.match(primitives, /type="file" aria-label="文件"/u);
});

test("project files preserve folders, viewer links and the four-item action contract", async () => {
  const [workspace, schema, migration, route, workflow] = await Promise.all([
    source("components/project/ProjectFileWorkspace.tsx"), source("lib/db/schema/project-documents.ts"), source("drizzle/0032_mantine_file_workspace.sql"), source("app/[...slug]/page.tsx"), source(".github/workflows/ci.yml"),
  ]);
  for (const label of ["分享", "复制链接", "创建副本", "删除"]) assert.match(workspace, new RegExp(label, "u"));
  for (const contract of [/新建文件夹/u, /FOLDER_NOT_EMPTY|仅空文件夹/u, /documentViewerPath/u, /sortKey/u, /folderId/u, /搜索是项目范围/u]) assert.match(workspace, contract);
  assert.match(schema, /projectDocumentFolder/u);
  assert.match(migration, /project_document_folders/u);
  assert.match(route, /child === "artifacts"/u);
  assert.match(route, /\/files/u);
  assert.match(workflow, /npm run test:file-workspace/u);
});

test("delete, duplicate and preview remain server-authorized and fail closed", async () => {
  const [documents, preview, textPreview] = await Promise.all([source("lib/files/document-service.ts"), source("app/api/projects/[projectId]/documents/[documentId]/versions/[versionId]/preview/route.ts"), source("lib/files/text-preview.ts")]);
  for (const contract of [/DOCUMENT_HAS_FORMAL_REFERENCES/u, /deleteScopedRows/u, /\.delete\(projectDocument\)/u, /sourceDigest !== currentVersion\.sha256/u, /document_duplicated/u]) assert.match(documents, contract);
  assert.match(preview, /requireProjectDocumentVersionResource/u);
  assert.match(textPreview, /label: "utf-8"/u);
  assert.match(textPreview, /label: "gb18030"/u);
});

test("viewer, assistant and requirement overview retain security and versioning contracts", async () => {
  const [viewer, route, assistant, requirement, service] = await Promise.all([source("components/document-viewer/DocumentViewer.tsx"), source("lib/documents/viewer-route.ts"), source("components/knowledge/ProjectAssistantPanel.tsx"), source("components/requirement-overview/RequirementOverviewWorkspace.tsx"), source("lib/focused-mvp/requirement-overview.ts")]);
  for (const contract of [/pdfjs-dist/u, /renderAsync/u, /DOCUMENT_SERVER_NOT_CONFIGURED/u, /rehypeSanitize/u]) assert.match(viewer, contract);
  assert.match(route, /publicDocumentViewerPath/u);
  assert.match(assistant, /components\/ui\/project-primitives/u);
  assert.match(await source("components/ui/project-primitives.tsx"), /ShadcnTooltip/u);
  assert.match(assistant, /components\/ui\/textarea/u);
  assert.doesNotMatch(assistant, /<select/u);
  assert.match(service, /pg_advisory_xact_lock/u);
  assert.match(requirement, /重新生成/u);
  assert.match(requirement, /另存为新版本/u);
});

test("shared shadcn shells preserve responsive and accessible navigation contracts", async () => {
  const [projects, company, projectContext, shell, sidebar, topbar, models, organization] = await Promise.all([
    source("components/project/ProjectsPage.tsx"),
    source("components/knowledge/CompanyKnowledgePage.tsx"),
    source("components/project/ProjectContextHeader.tsx"),
    source("components/common/page-shell.tsx"),
    source("components/layout/sidebar.tsx"),
    source("components/layout/topbar.tsx"),
    source("components/system/AiModelManagementPage.tsx"),
    source("components/organization/OrganizationPage.tsx"),
  ]);
  assert.match(projects, /<PageShell/u);
  assert.match(projects, /<PageHeader/u);
  assert.match(projects, /<FilterBar/u);
  assert.match(projects, /title="项目资料"/u);
  assert.match(company, /<Title order=\{2\}>公司资料<\/Title>/u);
  assert.match(projectContext, /<Title order=\{1\} size="h2" lineClamp=\{1\}>\{project\.name\}<\/Title>/u);
  assert.doesNotMatch(projectContext, /<Title[^>]*>\{project\.id\}<\/Title>/u);
  assert.match(shell, /sm:px-6 lg:px-8/u);
  assert.match(sidebar, /Tooltip/u);
  assert.match(topbar, /System|跟随系统/u);
  assert.doesNotMatch(`${models}\n${organization}`, /window\.confirm/u);
  assert.match(organization, /aria-label/u);
});
