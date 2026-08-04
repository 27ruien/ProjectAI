"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Button,
  Divider,
  Drawer,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Maximize2,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { renderAsync as renderDocx } from "docx-preview";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import {
  documentErrorMessage,
  downloadProjectDocumentVersion,
  projectDocumentPreviewUrl,
  readProjectDocumentTextPreview,
} from "@/lib/documents/client";
import type { ProjectDocumentDto, ProjectDocumentVersionDto } from "@/types/documents";

type Props = {
  project: AuthorizedProjectSummary;
  document: ProjectDocumentDto;
  version: ProjectDocumentVersionDto;
};

type PdfDocument = Awaited<ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>["promise"]>;

function usePreviewError() {
  const [error, setError] = useState<string | null>(null);
  const capture = useCallback((caught: unknown) => setError(documentErrorMessage(caught)), []);
  return { error, capture };
}

function TextViewer({ document, version }: Pick<Props, "document" | "version">) {
  const searchParams = useSearchParams();
  const requestedLine = Math.max(1, Number(searchParams.get("line") || 1));
  const [content, setContent] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<string>("");
  const [query, setQuery] = useState("");
  const { error, capture } = usePreviewError();
  useEffect(() => {
    const controller = new AbortController();
    void readProjectDocumentTextPreview(
      document.projectId,
      document.id,
      version.id,
      controller.signal,
    )
      .then((result) => {
        setContent(result.content);
        setEncoding(result.detectedEncoding.toUpperCase());
      })
      .catch(capture);
    return () => controller.abort();
  }, [capture, document.id, document.projectId, version.id]);
  if (error) return <Alert color="red" title="无法打开文本预览">{error}</Alert>;
  if (content === null) return <Group justify="center" py="xl"><Loader size="sm" /><Text size="sm">正在安全解码原文件</Text></Group>;
  const lines = content.split(/\r?\n/);
  const isMarkdown = ["md", "markdown"].includes(version.extension);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          leftSection={<Search size={14} />}
          placeholder="在文件中搜索"
          w={280}
        />
        <Badge variant="light" color="gray">{encoding} · {lines.length} 行</Badge>
      </Group>
      <Paper withBorder radius="md" p="lg" mih={540} data-testid="text-viewer">
        {isMarkdown ? (
          <Box className="prose prose-sm max-w-none text-foreground" data-testid="markdown-viewer">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {content}
            </ReactMarkdown>
          </Box>
        ) : (
          <Box component="pre" m={0} ff="var(--font-geist-mono)" fz="sm" style={{ whiteSpace: "pre-wrap" }}>
            {lines.map((line, index) => {
              const lineNumber = index + 1;
              const match = normalizedQuery && line.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
              return (
                <Box
                  component="span"
                  key={lineNumber}
                  id={`line-${lineNumber}`}
                  display="block"
                  bg={match || lineNumber === requestedLine ? "projectBlue.0" : undefined}
                >
                  <Text component="span" c="dimmed" mr="md" aria-hidden>{String(lineNumber).padStart(4, " ")}</Text>
                  {line || " "}
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>
    </Stack>
  );
}

function PdfThumbnail({ pdf, pageNumber, active, onSelect }: { pdf: PdfDocument; pageNumber: number; active: boolean; onSelect: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale: 0.16 });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    });
    return () => { cancelled = true; };
  }, [pageNumber, pdf]);
  return (
    <button type="button" onClick={onSelect} className={`rounded-lg border p-1 ${active ? "border-primary bg-primary/5" : "bg-white"}`} aria-label={`打开第 ${pageNumber} 页`}>
      <canvas ref={canvasRef} className="mx-auto max-w-full" />
      <Text size="xs" ta="center" mt={4}>{pageNumber}</Text>
    </button>
  );
}

function PdfViewer({ document, version }: Pick<Props, "document" | "version">) {
  const searchParams = useSearchParams();
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageNumber, setPageNumber] = useState(Math.max(1, Number(searchParams.get("page") || 1)));
  const [scale, setScale] = useState(1.1);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { error, capture } = usePreviewError();
  const previewUrl = projectDocumentPreviewUrl(document.projectId, document.id, version.id);
  useEffect(() => {
    let cancelled = false;
    void import("pdfjs-dist").then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const loaded = await pdfjs.getDocument({ url: previewUrl, withCredentials: true }).promise;
      if (!cancelled) setPdf(loaded);
    }).catch(capture);
    return () => { cancelled = true; };
  }, [capture, previewUrl]);
  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    void pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
    }).catch(capture);
    return () => { cancelled = true; };
  }, [capture, pageNumber, pdf, scale]);
  const searchPdf = async () => {
    if (!pdf || !query.trim()) return;
    setSearching(true);
    try {
      const needle = query.trim().toLocaleLowerCase("zh-CN");
      for (let page = 1; page <= pdf.numPages; page += 1) {
        const text = await (await pdf.getPage(page)).getTextContent();
        const value = text.items.map((item) => ("str" in item ? item.str : "")).join(" ").toLocaleLowerCase("zh-CN");
        if (value.includes(needle)) { setPageNumber(page); break; }
      }
    } finally { setSearching(false); }
  };
  if (error) return <Alert color="red" title="PDF 预览失败">{error}</Alert>;
  if (!pdf) return <Group justify="center" py="xl"><Loader size="sm" /><Text size="sm">正在加载 PDF</Text></Group>;
  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="wrap">
        <Group gap="xs">
          <ActionIcon variant="subtle" onClick={() => setPageNumber((value) => Math.max(1, value - 1))} disabled={pageNumber === 1} aria-label="上一页"><ChevronLeft size={16} /></ActionIcon>
          <Text size="sm">第 {pageNumber} / {pdf.numPages} 页</Text>
          <ActionIcon variant="subtle" onClick={() => setPageNumber((value) => Math.min(pdf.numPages, value + 1))} disabled={pageNumber === pdf.numPages} aria-label="下一页"><ChevronRight size={16} /></ActionIcon>
          <Divider orientation="vertical" />
          <ActionIcon variant="subtle" onClick={() => setScale((value) => Math.max(0.5, value - 0.15))} aria-label="缩小"><ZoomOut size={16} /></ActionIcon>
          <Text size="xs" c="dimmed">{Math.round(scale * 100)}%</Text>
          <ActionIcon variant="subtle" onClick={() => setScale((value) => Math.min(2.5, value + 0.15))} aria-label="放大"><ZoomIn size={16} /></ActionIcon>
        </Group>
        <Group gap="xs">
          <TextInput value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索 PDF" leftSection={<Search size={14} />} onKeyDown={(event) => { if (event.key === "Enter") void searchPdf(); }} />
          <Button variant="light" loading={searching} onClick={() => void searchPdf()}>查找</Button>
        </Group>
      </Group>
      <Box display="grid" style={{ gridTemplateColumns: "112px minmax(0, 1fr)" }} mih={640}>
        <ScrollArea h={640} pr="sm">
          <Stack gap="xs">
            {Array.from({ length: pdf.numPages }, (_, index) => (
              <PdfThumbnail key={index + 1} pdf={pdf} pageNumber={index + 1} active={pageNumber === index + 1} onSelect={() => setPageNumber(index + 1)} />
            ))}
          </Stack>
        </ScrollArea>
        <ScrollArea h={640} bg="gray.1" p="md">
          <canvas ref={canvasRef} className="mx-auto block max-w-none bg-white shadow-sm" />
        </ScrollArea>
      </Box>
    </Stack>
  );
}

function DocxViewer({ document, version }: Pick<Props, "document" | "version">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { error, capture } = usePreviewError();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(projectDocumentPreviewUrl(document.projectId, document.id, version.id), {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("DOCX_PREVIEW_FAILED");
        if (!containerRef.current) return;
        await renderDocx(await response.blob(), containerRef.current, undefined, {
          className: "project-docx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          useBase64URL: true,
        });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) capture(caught);
      });
    return () => controller.abort();
  }, [capture, document.id, document.projectId, version.id]);
  if (error) return <Alert color="red" title="DOCX 轻量预览失败">在线文档服务未配置，你可以下载原文件。</Alert>;
  return (
    <Stack gap="sm">
      <Alert color="blue" title="轻量只读预览">复杂分页或字体可能与 Word 略有差异。Staging 资源不足，暂未启动 ONLYOFFICE。</Alert>
      <Paper withBorder bg="gray.1" p="lg" mih={600}><Box ref={containerRef} className="project-docx-host" /></Paper>
    </Stack>
  );
}

function OfficeUnavailable({ extension }: { extension: string }) {
  return (
    <Paper withBorder radius="lg" p="xl" mih={440} style={{ display: "grid", placeItems: "center" }}>
      <Stack align="center" maw={480}>
        <FileSpreadsheet size={42} color="var(--mantine-color-projectBlue-6)" />
        <Title order={3}>{extension.toUpperCase()} 在线版式预览尚未配置</Title>
        <Text c="dimmed" ta="center">文件已完成内容解析，可供 AI 检索。当前 Staging 资源不足以安全运行 ONLYOFFICE，请下载原文件查看完整排版。</Text>
        <Badge variant="light">DOCUMENT_SERVER_NOT_CONFIGURED</Badge>
      </Stack>
    </Paper>
  );
}

export function DocumentViewer({ project, document, version }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const preview = useMemo(() => {
    if (["md", "markdown", "txt"].includes(version.extension)) return <TextViewer document={document} version={version} />;
    if (version.extension === "pdf") return <PdfViewer document={document} version={version} />;
    if (version.extension === "docx") return <DocxViewer document={document} version={version} />;
    if (["xlsx", "pptx"].includes(version.extension)) return <OfficeUnavailable extension={version.extension} />;
    return <Alert color="gray" title="该格式暂不支持在线预览">你仍然可以下载原文件。</Alert>;
  }, [document, version]);
  // `next/link` receives an application-relative path and applies basePath.
  const filesHref = `/data-spaces/projects/${encodeURIComponent(project.id)}/files`;
  const download = () => downloadProjectDocumentVersion(project.id, document.id, version.id, version.originalFilename);
  return (
    <Box px={{ base: "md", md: "xl" }} py="lg">
      <Stack gap="md">
        <Breadcrumbs fz="sm">
          <Anchor component={Link} href={filesHref}>项目资料</Anchor>
          <Text>{project.name}</Text>
          <Text>{document.displayName}</Text>
        </Breadcrumbs>
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group align="flex-start">
            <Tooltip label="返回项目资料"><ActionIcon component={Link} href={filesHref} variant="subtle" size="lg" aria-label="返回项目资料"><ArrowLeft size={18} /></ActionIcon></Tooltip>
            <Stack gap={2}>
              <Group gap="xs"><FileText size={20} color="var(--mantine-color-projectBlue-6)" /><Title order={2}>{document.displayName}</Title></Group>
              <Text size="sm" c="dimmed">v{version.versionNumber} · {version.originalFilename} · {version.uploadedBy.displayName}</Text>
            </Stack>
          </Group>
          <Group>
            <Button variant="default" leftSection={<Maximize2 size={15} />} onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}>新窗口打开</Button>
            {document.permissions.canDownload ? <Button leftSection={<Download size={15} />} onClick={() => void download()}>下载</Button> : null}
            <Button variant="light" onClick={() => setDetailsOpen(true)}>文件详情</Button>
          </Group>
        </Group>
        {preview}
      </Stack>
      <Drawer opened={detailsOpen} onClose={() => setDetailsOpen(false)} title="文件详情" position="right">
        <Stack gap="sm">
          <Text fw={600}>{document.displayName}</Text>
          <Text size="sm">类型：{version.extension.toUpperCase()}</Text>
          <Text size="sm">版本：v{version.versionNumber}</Text>
          <Text size="sm">上传人：{version.uploadedBy.displayName}</Text>
          <Text size="sm">更新时间：{new Date(document.updatedAt).toLocaleString("zh-CN")}</Text>
          <Text size="sm">处理状态：{version.ingestion.status}</Text>
          <Text size="sm" c="dimmed">用户预览读取原始不可变版本；AI 抽取与向量索引不参与版式渲染。</Text>
        </Stack>
      </Drawer>
    </Box>
  );
}
