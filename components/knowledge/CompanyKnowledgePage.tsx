"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Menu,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { Library, LoaderCircle, MoreHorizontal, RefreshCw, Search, Upload } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { ProjectDocumentDto, ProjectDocumentVersionDto } from "@/types/documents";
import { useToast } from "@/components/common/toast";
import { retryProjectDocumentEmbedding } from "@/lib/documents/client";

type Category = "charter" | "hr" | "project_management" | "security" | "finance" | "template" | "other";
type Lifecycle = "draft" | "published" | "expired" | "archived";
type Audience = "organization" | "department" | "admin";
type CompanyDocument = ProjectDocumentDto & {
  category: Category;
  lifecycleStatus: Lifecycle;
  audience: Audience;
  departmentId: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
};
type Department = { id: string; name: string };

const categoryLabels: Record<Category, string> = {
  charter: "公司章程",
  hr: "人事制度",
  project_management: "项目管理规范",
  security: "信息安全",
  finance: "财务与采购",
  template: "标准模板",
  other: "其他",
};
const lifecycleLabels: Record<Lifecycle, string> = {
  draft: "草稿",
  published: "已发布",
  expired: "已失效",
  archived: "已归档",
};
const lifecycleColors: Record<Lifecycle, string> = {
  draft: "gray",
  published: "green",
  expired: "orange",
  archived: "gray",
};
const audienceLabels: Record<Audience, string> = {
  organization: "全公司",
  department: "指定部门",
  admin: "仅管理员",
};

function vectorStatus(version: ProjectDocumentVersionDto | null) {
  if (!version || version.ingestion.status !== "succeeded") {
    return {
      label: version?.ingestion.status === "failed" ? "解析失败" : "等待解析",
      color: version?.ingestion.status === "failed" ? "red" : "gray",
    };
  }
  return {
    not_started: { label: "等待向量化", color: "blue" },
    pending: { label: "等待向量化", color: "blue" },
    running: { label: "正在向量化", color: "blue" },
    succeeded: { label: "可用于 AI", color: "green" },
    failed: { label: "向量化失败", color: "red" },
    unknown: { label: "等待管理员复核", color: "orange" },
  }[version.embedding.status];
}

export function CompanyKnowledgePage() {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | Category>("all");
  const [status, setStatus] = useState<"all" | Lifecycle>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadVersionNote, setUploadVersionNote] = useState("");
  const [uploadCategory, setUploadCategory] = useState<Category>("project_management");
  const [audience, setAudience] = useState<Audience>("organization");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    document: CompanyDocument;
    versions: ProjectDocumentVersionDto[];
  } | null>(null);
  const [versionTarget, setVersionTarget] = useState<CompanyDocument | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNote, setVersionNote] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(withBasePath("/api/company-knowledge"), {
      credentials: "include",
      cache: "no-store",
    });
    const body = (await response.json()) as {
      documents?: CompanyDocument[];
      canManage?: boolean;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(body.error?.message ?? "公司资料加载失败");
    setDocuments(body.documents ?? []);
    setCanManage(Boolean(body.canManage));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) =>
        setError(caught instanceof Error ? caught.message : "公司资料加载失败"),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const processing = documents.some((document) => {
      const version = document.currentVersion;
      return (
        version?.ingestion.status === "pending" ||
        version?.ingestion.status === "running" ||
        version?.embedding.status === "pending" ||
        version?.embedding.status === "running"
      );
    });
    if (!processing) return;
    const timer = window.setInterval(() => void load().catch(() => undefined), 2_500);
    return () => window.clearInterval(timer);
  }, [documents, load]);

  useEffect(() => {
    if (!canManage) return;
    void fetch(withBasePath("/api/projects/creation-context"), {
      credentials: "include",
    })
      .then(async (response) => response.json() as Promise<{ departments?: Department[] }>)
      .then((body) => setDepartments(body.departments ?? []))
      .catch(() => undefined);
  }, [canManage]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return documents.filter(
      (item) =>
        (category === "all" || item.category === category) &&
        (status === "all" || item.lifecycleStatus === status) &&
        (!keyword || item.displayName.toLocaleLowerCase("zh-CN").includes(keyword)),
    );
  }, [category, documents, query, status]);

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("displayName", file.name.replace(/\.[^.]+$/, ""));
      form.set("category", uploadCategory);
      form.set("audience", audience);
      if (uploadVersionNote.trim()) form.set("versionNote", uploadVersionNote.trim());
      if (audience === "department") form.set("departmentId", departmentId);
      const response = await fetch(withBasePath("/api/company-knowledge"), {
        method: "POST",
        credentials: "include",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: form,
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "上传失败");
      setUploadOpen(false);
      setFile(null);
      setUploadVersionNote("");
      await load();
      toast("常规模板已上传为草稿");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const changeLifecycle = async (document: CompanyDocument, lifecycleStatus: Lifecycle) => {
    setError(null);
    const response = await fetch(withBasePath(`/api/company-knowledge/${document.id}`), {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lifecycleStatus }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "状态更新失败");
      return;
    }
    await load();
    toast(`“${document.displayName}”已更新为${lifecycleLabels[lifecycleStatus]}`);
  };

  const newVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!versionTarget || !versionFile) return;
    const form = new FormData();
    form.set("file", versionFile);
    if (versionNote.trim()) form.set("versionNote", versionNote.trim());
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        withBasePath(`/api/company-knowledge/${versionTarget.id}/versions`),
        {
          method: "POST",
          credentials: "include",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: form,
        },
      );
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "新版本上传失败");
      }
      setVersionTarget(null);
      setVersionFile(null);
      setVersionNote("");
      await load();
      toast("新版本已上传为草稿");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "新版本上传失败");
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (document: CompanyDocument) => {
    const response = await fetch(
      withBasePath(`/api/company-knowledge/${document.id}/versions`),
      { credentials: "include", cache: "no-store" },
    );
    const body = (await response.json()) as {
      versions?: ProjectDocumentVersionDto[];
      error?: { message?: string };
    };
    if (!response.ok) {
      setError(body.error?.message ?? "版本历史加载失败");
      return;
    }
    setHistory({ document, versions: body.versions ?? [] });
  };

  const retryEmbedding = async (document: CompanyDocument) => {
    const version = document.currentVersion;
    if (!version || version.embedding.status !== "failed") return;
    setBusy(true);
    setError(null);
    try {
      await retryProjectDocumentEmbedding(document.projectId, document.id, version.id);
      await load();
      toast(`“${document.displayName}”已重新进入向量化队列`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "向量化重试失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="main" className="min-h-full" px={{ base: "md", sm: "lg", lg: "xl" }} py="xl" data-testid="company-knowledge-page">
      <Group component="header" justify="space-between" align="end" mb="lg" gap="md">
        <Box>
          <Title order={2}>公司资料</Title>
          <Text mt={6} size="sm" c="dimmed">
            维护公司制度、项目管理 SOP 与标准模板；AI 助手按问题自动使用已发布且有权访问的当前版本。
          </Text>
        </Box>
        {canManage ? <Button leftSection={<Upload size={16} />} onClick={() => setUploadOpen(true)}>上传公司资料</Button> : null}
      </Group>
      {error ? <Alert color="red" mb="md">{error}</Alert> : null}
      <Group mb="md" align="end" gap="sm">
        <TextInput value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索公司资料" leftSection={<Search size={16} />} style={{ flex: "1 1 260px" }} maw={420} />
        <Select value={category} onChange={(value) => setCategory((value ?? "all") as typeof category)} data={[{ value: "all", label: "全部类别" }, ...Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))]} w={180} />
        <Select value={status} onChange={(value) => setStatus((value ?? "all") as typeof status)} data={[{ value: "all", label: "全部状态" }, ...Object.entries(lifecycleLabels).map(([value, label]) => ({ value, label }))]} w={150} />
      </Group>
      <Box bg="white" bd="1px solid var(--mantine-color-gray-3)" style={{ borderRadius: "var(--mantine-radius-md)", overflow: "hidden" }}>
        {filtered.length ? (
          <Table.ScrollContainer minWidth={980}>
            <Table verticalSpacing="sm" highlightOnHover>
              <Table.Thead><Table.Tr><Table.Th>模板名称</Table.Th><Table.Th>分类</Table.Th><Table.Th>当前版本</Table.Th><Table.Th>处理状态</Table.Th><Table.Th>可见范围</Table.Th><Table.Th>状态</Table.Th><Table.Th>更新时间</Table.Th><Table.Th><span className="sr-only">操作</span></Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {filtered.map((document) => {
                  const processing = vectorStatus(document.currentVersion);
                  return <Table.Tr key={document.id}><Table.Td><Group gap="sm"><Box bg="gray.1" c="dimmed" p={7} style={{ borderRadius: "var(--mantine-radius-md)" }}><Library size={16} /></Box><Text fw={600} lineClamp={1} maw={260}>{document.displayName}</Text></Group></Table.Td><Table.Td>{categoryLabels[document.category]}</Table.Td><Table.Td>v{document.currentVersion?.versionNumber ?? "—"}</Table.Td><Table.Td><Badge variant="light" color={processing.color}>{processing.label}</Badge></Table.Td><Table.Td>{audienceLabels[document.audience]}</Table.Td><Table.Td><Badge variant="light" color={lifecycleColors[document.lifecycleStatus]}>{lifecycleLabels[document.lifecycleStatus]}</Badge></Table.Td><Table.Td><Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>{new Date(document.updatedAt).toLocaleString("zh-CN")}</Text></Table.Td><Table.Td><DocumentActions document={document} canManage={canManage} busy={busy} onHistory={() => void openHistory(document)} onVersion={() => setVersionTarget(document)} onRetry={() => void retryEmbedding(document)} onLifecycle={(next) => void changeLifecycle(document, next)} /></Table.Td></Table.Tr>;
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Stack align="center" justify="center" mih={288} p="xl"><Library size={36} color="var(--mantine-color-gray-5)" /><Text fw={600}>暂无可见常规模板</Text><Text size="sm" c="dimmed" ta="center">管理员上传并发布后，会话才会按权限检索这些资料。</Text>{canManage ? <Button mt="sm" leftSection={<Upload size={16} />} onClick={() => setUploadOpen(true)}>上传模板</Button> : null}</Stack>
        )}
      </Box>

      <KnowledgeUploadModal open={uploadOpen} onOpenChange={setUploadOpen} busy={busy} file={file} onFile={setFile} category={uploadCategory} onCategory={setUploadCategory} audience={audience} onAudience={setAudience} departmentId={departmentId} onDepartment={setDepartmentId} departments={departments} note={uploadVersionNote} onNote={setUploadVersionNote} onSubmit={upload} />
      <VersionUploadModal target={versionTarget} busy={busy} file={versionFile} onFile={setVersionFile} note={versionNote} onNote={setVersionNote} onClose={() => { setVersionTarget(null); setVersionFile(null); setVersionNote(""); }} onSubmit={newVersion} />
      <Drawer opened={Boolean(history)} onClose={() => setHistory(null)} title="版本历史" position="right" size="md"><Text size="sm" c="dimmed" mb="md">{history?.document.displayName}</Text><Stack gap="sm">{history?.versions.map((version) => <Box key={version.id} p="sm" bd="1px solid var(--mantine-color-gray-3)" style={{ borderRadius: "var(--mantine-radius-md)" }}><Group justify="space-between" align="start"><Box><Text fw={600} size="sm">v{version.versionNumber}{version.isCurrent ? " · 当前" : ""}</Text><Text size="xs" c="dimmed" mt={4}>{new Date(version.createdAt).toLocaleString("zh-CN")}</Text>{version.versionNote ? <Text size="xs" mt={4}>{version.versionNote}</Text> : null}</Box><Button component="a" variant="subtle" size="compact-sm" href={withBasePath(`/api/company-knowledge/${history.document.id}/versions/${version.id}/download`)}>下载</Button></Group></Box>)}</Stack></Drawer>
    </Box>
  );
}

function DocumentActions({ document, canManage, busy, onHistory, onVersion, onRetry, onLifecycle }: { document: CompanyDocument; canManage: boolean; busy: boolean; onHistory: () => void; onVersion: () => void; onRetry: () => void; onLifecycle: (status: Lifecycle) => void }) {
  const version = document.currentVersion;
  return <Menu position="bottom-end"><Menu.Target><ActionIcon variant="subtle" aria-label={`${document.displayName} 操作`} disabled={busy}><MoreHorizontal size={18} /></ActionIcon></Menu.Target><Menu.Dropdown>{version ? <><Menu.Item component="a" target="_blank" rel="noreferrer" href={withBasePath(`/api/company-knowledge/${document.id}/versions/${version.id}/download?preview=true`)}>预览</Menu.Item><Menu.Item component="a" href={withBasePath(`/api/company-knowledge/${document.id}/versions/${version.id}/download`)}>下载</Menu.Item></> : null}<Menu.Item onClick={onHistory}>查看版本历史</Menu.Item>{canManage ? <><Menu.Item onClick={onVersion}>上传新版本</Menu.Item>{version?.embedding.status === "failed" ? <Menu.Item leftSection={<RefreshCw size={14} />} onClick={onRetry}>重试向量化</Menu.Item> : null}<Menu.Divider />{document.lifecycleStatus !== "published" ? <Menu.Item onClick={() => onLifecycle("published")}>发布</Menu.Item> : <Menu.Item onClick={() => onLifecycle("expired")}>标记失效</Menu.Item>}<Menu.Item onClick={() => onLifecycle("archived")}>归档</Menu.Item><Menu.Item disabled>权限设置（由可见范围控制）</Menu.Item></> : null}</Menu.Dropdown></Menu>;
}

function KnowledgeUploadModal({ open, onOpenChange, busy, file, onFile, category, onCategory, audience, onAudience, departmentId, onDepartment, departments, note, onNote, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; busy: boolean; file: File | null; onFile: (file: File | null) => void; category: Category; onCategory: (value: Category) => void; audience: Audience; onAudience: (value: Audience) => void; departmentId: string; onDepartment: (value: string) => void; departments: Department[]; note: string; onNote: (value: string) => void; onSubmit: (event: FormEvent) => void }) {
  return <Modal opened={open} onClose={() => onOpenChange(false)} title="上传模板" centered data-testid="company-upload-dialog"><Text size="sm" c="dimmed" mb="md">新模板先保存为草稿，人工检查后再发布。</Text><form onSubmit={onSubmit}><Stack><TextInput label="文件" type="file" required onChange={(event) => onFile(event.currentTarget.files?.[0] ?? null)} /><Select label="分类" value={category} onChange={(value) => onCategory((value ?? "project_management") as Category)} data={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))} /><Select label="可见范围" value={audience} onChange={(value) => onAudience((value ?? "organization") as Audience)} data={[{ value: "organization", label: "全公司" }, { value: "department", label: "指定部门" }, { value: "admin", label: "仅管理员" }]} />{audience === "department" ? <Select label="部门" value={departmentId} onChange={(value) => onDepartment(value ?? "")} placeholder="请选择部门" data={departments.map((item) => ({ value: item.id, label: item.name }))} /> : null}<Textarea label="版本说明（可选）" value={note} onChange={(event) => onNote(event.currentTarget.value)} minRows={3} maxLength={500} /><TextInput label="发布状态" value="草稿（上传后人工发布）" disabled /><Group justify="flex-end"><Button type="button" variant="default" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy || !file} loading={busy} leftSection={busy ? <LoaderCircle size={16} /> : null}>上传草稿</Button></Group></Stack></form></Modal>;
}

function VersionUploadModal({ target, busy, file, onFile, note, onNote, onClose, onSubmit }: { target: CompanyDocument | null; busy: boolean; file: File | null; onFile: (file: File | null) => void; note: string; onNote: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  return <Modal opened={Boolean(target)} onClose={onClose} title="上传新版本" centered><Text size="sm" c="dimmed" mb="md">{target?.displayName} · 新版本默认回到草稿。</Text><form onSubmit={onSubmit}><Stack><TextInput label="文件" type="file" required onChange={(event) => onFile(event.currentTarget.files?.[0] ?? null)} /><Textarea label="版本说明（可选）" value={note} onChange={(event) => onNote(event.currentTarget.value)} minRows={3} maxLength={500} /><Group justify="flex-end"><Button type="button" variant="default" onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !file} loading={busy} leftSection={busy ? <LoaderCircle size={16} /> : null}>上传新版本</Button></Group></Stack></form></Modal>;
}
