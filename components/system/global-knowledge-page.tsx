"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Bot,
  Download,
  Eye,
  FileText,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Search,
  Settings2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/common";
import { ProjectAssistantPanel } from "@/components/knowledge";
import { useSearchParams } from "next/navigation";
import type { ProjectUiPermissions, ViewerContext } from "@/lib/auth/ui-types";
import {
  documentErrorMessage,
  downloadProjectDocumentVersion,
  listProjectDocuments,
  uploadProjectDocument,
} from "@/lib/documents/client";
import { withBasePath } from "@/lib/base-path";
import type { ProjectDocumentDto, ProjectDocumentListResponse } from "@/types/documents";

type KnowledgeSpaceSummary = {
  id: string;
  name: string;
  description: string;
  type: "department" | "project";
  visibility: string;
  departmentId: string | null;
  departmentName: string | null;
  projectId: string | null;
  projectName: string | null;
  projectContextId: string | null;
  accessLevel: "view" | "edit";
  permissions: ProjectUiPermissions | null;
  canUpload: boolean;
  canManageMembers: boolean;
  createdBy: string;
  updatedAt: string;
};

type KnowledgeIndex = {
  organization: { id: string; name: string } | null;
  departments: Array<{ id: string; name: string; level: number; parentDepartmentId: string | null }>;
  knowledgeSpaces: KnowledgeSpaceSummary[];
};

type SpaceMemberPayload = {
  space: { id: string; name: string; createdBy: string };
  members: Array<{
    userId: string;
    displayName: string;
    accessLevel: "view" | "edit";
    isCreator: boolean;
  }>;
  eligibleUsers: Array<{ userId: string; displayName: string; productRole: string }>;
};

function requireProjectPermissionContracts(index: KnowledgeIndex): KnowledgeIndex {
  const missing = index.knowledgeSpaces.find(
    (space) => space.type === "project" && !space.permissions,
  );
  if (missing) {
    throw new Error(`权限数据不可用：项目空间 ${missing.name} 缺少服务端权限契约。`);
  }
  return index;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(path), {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as T | { error?: { message?: string } } | null;
  if (!response.ok) {
    throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? "请求失败");
  }
  return body as T;
}

export function GlobalKnowledgePage({ viewer }: { viewer: ViewerContext }) {
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("projectId");
  const [index, setIndex] = useState<KnowledgeIndex | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState("");
  const [documentsByProject, setDocumentsByProject] = useState<Record<string, ProjectDocumentListResponse>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"space" | "department" | "all">("space");
  const [uploading, setUploading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedSpace = index?.knowledgeSpaces.find((item) => item.id === selectedSpaceId) ?? index?.knowledgeSpaces[0];
  const selectedProject = viewer.projects.find((item) => item.id === selectedSpace?.projectContextId);

  const refreshIndex = useCallback(async () => {
    const next = requireProjectPermissionContracts(
      await api<KnowledgeIndex>("/api/knowledge-spaces"),
    );
    setIndex(next);
    setSelectedSpaceId((current) => next.knowledgeSpaces.some((item) => item.id === current) ? current : next.knowledgeSpaces[0]?.id ?? "");
    return next;
  }, []);

  const loadProject = useCallback(async (projectId: string) => {
    const payload = await listProjectDocuments(projectId, "active");
    setDocumentsByProject((current) => ({ ...current, [projectId]: payload }));
    return payload;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void api<KnowledgeIndex>("/api/knowledge-spaces", { signal: controller.signal })
      .then((next) => {
        requireProjectPermissionContracts(next);
        setIndex(next);
        setSelectedSpaceId(
          next.knowledgeSpaces.find((item) => item.projectId === requestedProjectId)?.id ??
          next.knowledgeSpaces[0]?.id ??
          "",
        );
      })
      .catch((caught) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "知识库加载失败");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [requestedProjectId]);

  useEffect(() => {
    const projectId = selectedSpace?.projectContextId;
    if (!projectId || documentsByProject[projectId]) return;
    void listProjectDocuments(projectId, "active")
      .then((payload) => setDocumentsByProject((current) => ({ ...current, [projectId]: payload })))
      .catch((caught) => setError(documentErrorMessage(caught)));
  }, [documentsByProject, selectedSpace?.projectContextId]);

  useEffect(() => {
    if (scope === "space" || !index) return;
    const relevant = index.knowledgeSpaces.filter((item) =>
      scope === "all" || item.departmentId === selectedSpace?.departmentId,
    );
    const missing = [...new Set(relevant.map((item) => item.projectContextId).filter((id): id is string => Boolean(id)))]
      .filter((id) => !documentsByProject[id]);
    if (!missing.length) return;
    void Promise.all(missing.map(loadProject)).catch((caught) => setError(documentErrorMessage(caught)));
  }, [documentsByProject, index, loadProject, scope, selectedSpace?.departmentId]);

  const visibleSpaceIds = useMemo(() => {
    if (!index || !selectedSpace) return new Set<string>();
    if (scope === "space") return new Set([selectedSpace.id]);
    if (scope === "department") return new Set(index.knowledgeSpaces.filter((item) => item.departmentId === selectedSpace.departmentId).map((item) => item.id));
    return new Set(index.knowledgeSpaces.map((item) => item.id));
  }, [index, scope, selectedSpace]);

  const documents = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    const deduplicated = new Map<string, ProjectDocumentDto>();
    for (const payload of Object.values(documentsByProject)) {
      for (const document of payload.documents) {
        if (visibleSpaceIds.has(document.knowledgeSpaceId)) deduplicated.set(document.id, document);
      }
    }
    return [...deduplicated.values()].filter((document) => document.displayName.toLocaleLowerCase("zh-CN").includes(keyword));
  }, [documentsByProject, query, visibleSpaceIds]);

  const upload = async (file: File) => {
    const canUpload = selectedSpace?.type === "project"
      ? selectedSpace.permissions?.canUploadDocuments
      : selectedSpace?.canUpload;
    if (!selectedSpace?.projectContextId || !canUpload) return;
    const payload = documentsByProject[selectedSpace.projectContextId] ?? await loadProject(selectedSpace.projectContextId);
    const destination = payload.permissions.uploadDestinations.find((item) => item.id === selectedSpace.id);
    if (!destination) {
      setError("当前空间为只读，或缺少可用的项目上下文。");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await uploadProjectDocument({
        projectId: selectedSpace.projectContextId,
        file,
        knowledgeSpaceId: selectedSpace.id,
        idempotencyKey: crypto.randomUUID(),
      });
      await loadProject(selectedSpace.projectContextId);
      setFeedback("文件已安全上传；解析完成后可用于检索和 AI 工作流。");
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (loading) return <div className="grid min-h-[50vh] place-items-center"><LoaderCircle className="size-6 animate-spin text-primary" /></div>;

  const selectedCanManageMembers = selectedSpace?.type === "project"
    ? Boolean(selectedSpace.permissions?.canManageMembers)
    : Boolean(selectedSpace?.canManageMembers);
  const selectedCanUpload = selectedSpace?.type === "project"
    ? Boolean(selectedSpace.permissions?.canUploadDocuments)
    : Boolean(selectedSpace?.canUpload);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge Base"
        title="知识库"
        description="文件列表、全文/向量检索与带引用的 AI 对话共用同一服务端权限边界。"
        actions={<button type="button" onClick={() => setCreateOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium"><FolderPlus className="size-4" />新建项目空间</button>}
      />
      {feedback ? <div role="status" className="rounded-xl border border-success/20 bg-success-soft px-4 py-3 text-sm text-success">{feedback}</div> : null}
      {error ? <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive-soft px-4 py-3 text-sm text-destructive">{error}</div> : null}

      {!index?.knowledgeSpaces.length ? (
        <EmptyKnowledge onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[260px_minmax(0,0.9fr)_minmax(420px,1.1fr)]">
          <SpaceTree index={index} selectedSpaceId={selectedSpace?.id ?? ""} onSelect={(id) => { setSelectedSpaceId(id); setScope("space"); setError(null); }} />
          <section className="overflow-hidden rounded-2xl border bg-card">
            <header className="border-b p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="flex items-center gap-2 text-sm font-semibold"><FolderOpen className="size-4 text-primary" />{selectedSpace?.name}</h2><p className="mt-1 text-[11px] text-muted-foreground">{selectedSpace?.departmentName ?? "未分配部门"} · {selectedSpace?.accessLevel === "edit" ? "可编辑" : "只读"}</p></div>
                <div className="flex gap-2">
                  {selectedSpace?.type === "project" && selectedSpace.permissions?.canEditProject ? <button type="button" onClick={() => setEditOpen(true)} className="grid size-9 place-items-center rounded-lg border" aria-label="编辑项目信息"><Pencil className="size-4" /></button> : null}
                  {selectedCanManageMembers ? <button type="button" onClick={() => setManageOpen(true)} className="grid size-9 place-items-center rounded-lg border" aria-label="管理空间成员"><Settings2 className="size-4" /></button> : null}
                  <button type="button" disabled={!selectedCanUpload || uploading} onClick={() => fileInput.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">{uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}上传</button>
                  <input ref={fileInput} type="file" hidden accept=".pdf,.docx,.xlsx,.pptx,.txt,.md" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <label className="flex h-10 items-center gap-2 rounded-lg border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10"><Search className="size-4 text-muted-foreground" /><span className="sr-only">搜索知识库文件</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="搜索有权访问的文件名" /></label>
                <select aria-label="搜索范围" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="h-10 rounded-lg border bg-background px-3 text-xs outline-none"><option value="space">当前空间</option><option value="department">当前部门</option><option value="all">全部可访问空间</option></select>
              </div>
            </header>
            <div className="divide-y">
              {documents.map((document) => <DocumentRow key={document.id} document={document} onError={setError} />)}
              {!documents.length ? <div className="px-5 py-12 text-center"><p className="text-sm font-medium">当前范围没有可见文件</p><p className="mt-1 text-xs text-muted-foreground">可切换空间、调整搜索范围，或在有编辑权限的空间上传文件。</p></div> : null}
            </div>
          </section>
          <section className="rounded-2xl border bg-surface p-1">
            <div className="flex items-center justify-between gap-2 px-4 pt-4"><div className="flex items-center gap-2"><Bot className="size-4 text-primary" /><h2 className="text-sm font-semibold">AI 对话</h2></div><span className="text-[10px] text-muted-foreground">项目权限范围：{selectedProject?.name ?? "未绑定项目"}</span></div>
            {selectedProject ? <ProjectAssistantPanel project={selectedProject} /> : <div className="m-4 rounded-xl border border-dashed p-6 text-sm text-muted-foreground">当前空间尚无可用项目上下文。创建该部门下的项目空间后，即可使用带引用的 AI 查询。</div>}
          </section>
        </div>
      )}
      {createOpen ? <CreateProjectSpace departments={index?.departments ?? []} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await refreshIndex(); }} /> : null}
      {editOpen && selectedSpace?.type === "project" && selectedSpace.projectId ? <EditProjectSpace space={selectedSpace} onClose={() => setEditOpen(false)} onUpdated={async () => { setEditOpen(false); await refreshIndex(); setFeedback("项目信息已更新。"); }} /> : null}
      {manageOpen && selectedSpace ? <SpaceMembersDialog space={selectedSpace} onClose={() => setManageOpen(false)} /> : null}
    </div>
  );
}

function SpaceTree({ index, selectedSpaceId, onSelect }: { index: KnowledgeIndex; selectedSpaceId: string; onSelect: (id: string) => void }) {
  return <aside className="overflow-hidden rounded-2xl border bg-card"><header className="border-b px-4 py-3"><p className="text-xs font-semibold">{index.organization?.name ?? "知识空间"}</p><p className="mt-1 text-[10px] text-muted-foreground">仅显示你有权访问的空间</p></header><div className="max-h-[660px] overflow-y-auto p-2">{index.departments.map((department) => { const spaces = index.knowledgeSpaces.filter((item) => item.departmentId === department.id); if (!spaces.length) return null; return <section key={department.id} className="mb-2"><p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" style={{ paddingLeft: `${8 + Math.max(0, department.level - 1) * 10}px` }}>{department.name}</p>{spaces.map((space) => <button key={space.id} type="button" onClick={() => onSelect(space.id)} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${space.id === selectedSpaceId ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><FolderOpen className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{space.name}</span><span className="text-[9px] opacity-70">{space.type === "department" ? "部门" : "项目"}</span></button>)}</section>; })}</div></aside>;
}

function DocumentRow({ document, onError }: { document: ProjectDocumentDto; onError: (message: string) => void }) {
  const ingestion = document.currentVersion?.ingestion.status ?? "not_started";
  const [previewOpen, setPreviewOpen] = useState(false);
  const download = async () => {
    const version = document.currentVersion;
    if (!version) return;
    try {
      await downloadProjectDocumentVersion(document.projectId, document.id, version.id, version.originalFilename);
    } catch (caught) {
      onError(documentErrorMessage(caught));
    }
  };
  return <><article className="flex items-center gap-3 px-4 py-3.5"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary"><FileText className="size-4" /></span><button type="button" onClick={() => setPreviewOpen(true)} className="min-w-0 flex-1 text-left"><strong className="block truncate text-xs font-medium hover:text-primary">{document.displayName}</strong><p className="mt-1 text-[10px] text-muted-foreground">{document.createdBy.displayName} · {new Date(document.updatedAt).toLocaleDateString("zh-CN")} · {ingestion === "succeeded" ? "已索引" : ingestion === "failed" ? "解析失败" : "处理中"}</p></button><button type="button" disabled={!document.permissions.canDownload || !document.currentVersion} onClick={() => void download()} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" aria-label={`下载 ${document.displayName}`}><Download className="size-4" /></button></article>{previewOpen ? <Modal title={`文件详情 · ${document.displayName}`} onClose={() => setPreviewOpen(false)}><dl className="grid gap-3 text-xs sm:grid-cols-2"><div><dt className="text-muted-foreground">文件名</dt><dd className="mt-1 break-all font-medium">{document.displayName}</dd></div><div><dt className="text-muted-foreground">知识索引</dt><dd className="mt-1 font-medium">{ingestion === "succeeded" ? "已建立" : ingestion === "failed" ? "解析失败" : "处理中"}</dd></div><div><dt className="text-muted-foreground">上传者</dt><dd className="mt-1 font-medium">{document.createdBy.displayName}</dd></div><div><dt className="text-muted-foreground">更新时间</dt><dd className="mt-1 font-medium">{new Date(document.updatedAt).toLocaleString("zh-CN")}</dd></div></dl><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPreviewOpen(false)} className="h-9 rounded-lg border px-4 text-xs">关闭</button><button type="button" disabled={!document.permissions.canDownload || !document.currentVersion} onClick={() => void download()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"><Download className="size-3.5" />下载并打开</button></div></Modal> : null}</>;
}

function EmptyKnowledge({ onCreate }: { onCreate: () => void }) {
  return <section className="rounded-2xl border border-dashed bg-card px-6 py-16 text-center"><FolderPlus className="mx-auto size-8 text-primary" /><h2 className="mt-4 text-base font-semibold">还没有可访问的知识空间</h2><p className="mt-2 text-sm text-muted-foreground">成员可以在所属部门创建项目空间，并邀请成员设置查看或编辑权限。</p><button type="button" onClick={onCreate} className="mt-5 h-9 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground">新建项目空间</button></section>;
}

function CreateProjectSpace({ departments, onClose, onCreated }: { departments: KnowledgeIndex["departments"]; onClose: () => void; onCreated: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await api("/api/projects", { method: "POST", body: JSON.stringify({ name: String(values.get("name") || ""), clientName: "Kivisense Internal", description: String(values.get("description") || ""), departmentId: String(values.get("departmentId") || "") }) });
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目空间创建失败");
      setSubmitting(false);
    }
  };
  return <Modal title="新建项目空间" onClose={onClose}><form onSubmit={submit} className="space-y-4"><p className="text-xs text-muted-foreground">创建者自动获得编辑和成员管理权限；管理员默认可见。</p><label className="block text-xs font-medium">所属部门<select name="departmentId" required className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm">{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-xs font-medium">空间名称<input name="name" required minLength={2} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">说明<textarea name="description" rows={3} maxLength={4000} className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></label>{error ? <p role="alert" className="rounded-lg bg-destructive-soft p-3 text-xs text-destructive">{error}</p> : null}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-xs">取消</button><button disabled={submitting || !departments.length} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60">{submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}创建</button></div></form></Modal>;
}

function EditProjectSpace({ space, onClose, onUpdated }: {
  space: KnowledgeSpaceSummary;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!space.projectId) return;
    const values = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await api(`/api/projects/${encodeURIComponent(space.projectId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(values.get("name") || ""),
          description: String(values.get("description") || ""),
        }),
      });
      await onUpdated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目信息更新失败");
      setSubmitting(false);
    }
  };
  return <Modal title="编辑项目信息" onClose={onClose}><form onSubmit={submit} className="space-y-4"><p className="text-xs text-muted-foreground">此操作使用服务端返回的编辑能力显示入口，提交时仍会重新校验项目权限。</p><label className="block text-xs font-medium">空间名称<input name="name" defaultValue={space.name} required minLength={2} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary" /></label><label className="block text-xs font-medium">说明<textarea name="description" defaultValue={space.description} rows={3} maxLength={4000} className="mt-1.5 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary" /></label>{error ? <p role="alert" className="rounded-lg bg-destructive-soft p-3 text-xs text-destructive">{error}</p> : null}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-xs">取消</button><button disabled={submitting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60">{submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}保存</button></div></form></Modal>;
}

function SpaceMembersDialog({ space, onClose }: { space: KnowledgeSpaceSummary; onClose: () => void }) {
  const [payload, setPayload] = useState<SpaceMemberPayload | null>(null);
  const [userId, setUserId] = useState("");
  const [accessLevel, setAccessLevel] = useState<"view" | "edit">("view");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const next = await api<SpaceMemberPayload>(`/api/knowledge-spaces/${encodeURIComponent(space.id)}/members`);
    setPayload(next);
    setUserId((current) => current || next.eligibleUsers.find((item) => !next.members.some((member) => member.userId === item.userId))?.userId || next.eligibleUsers[0]?.userId || "");
  }, [space.id]);
  useEffect(() => {
    void api<SpaceMemberPayload>(`/api/knowledge-spaces/${encodeURIComponent(space.id)}/members`)
      .then((next) => {
        setPayload(next);
        setUserId(next.eligibleUsers.find((item) => !next.members.some((member) => member.userId === item.userId))?.userId || next.eligibleUsers[0]?.userId || "");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "成员加载失败"));
  }, [space.id]);
  const save = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/api/knowledge-spaces/${encodeURIComponent(space.id)}/members`, { method: "PUT", body: JSON.stringify({ userId, accessLevel }) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "权限保存失败");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (memberUserId: string) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/knowledge-spaces/${encodeURIComponent(space.id)}/members`, { method: "DELETE", body: JSON.stringify({ userId: memberUserId }) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移除成员失败");
    } finally {
      setSaving(false);
    }
  };
  return <Modal title={`空间成员 · ${space.name}`} onClose={onClose}><div className="space-y-4"><div className="grid gap-2 sm:grid-cols-[1fr_100px_auto]"><select aria-label="组织成员" value={userId} onChange={(event) => setUserId(event.target.value)} className="h-10 rounded-lg border bg-background px-3 text-xs"><option value="">选择组织成员</option>{payload?.eligibleUsers.map((item) => <option key={item.userId} value={item.userId}>{item.displayName}</option>)}</select><select aria-label="空间权限" value={accessLevel} onChange={(event) => setAccessLevel(event.target.value as "view" | "edit")} className="h-10 rounded-lg border bg-background px-3 text-xs"><option value="view">查看</option><option value="edit">编辑</option></select><button type="button" disabled={saving || !userId} onClick={() => void save()} className="inline-flex h-10 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"><UserPlus className="size-3.5" />邀请/更新</button></div>{error ? <p role="alert" className="rounded-lg bg-destructive-soft p-3 text-xs text-destructive">{error}</p> : null}<div className="divide-y rounded-xl border">{payload?.members.map((member) => <div key={member.userId} className="flex items-center gap-3 px-3 py-3"><span className="grid size-8 place-items-center rounded-full bg-muted"><Eye className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{member.displayName}{member.isCreator ? "（创建者）" : ""}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{member.accessLevel === "edit" ? "编辑" : "查看"}</p></div>{!member.isCreator ? <button type="button" disabled={saving} onClick={() => void remove(member.userId)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive-soft hover:text-destructive" aria-label={`移除 ${member.displayName}`}><X className="size-4" /></button> : null}</div>)}{payload && !payload.members.length ? <p className="p-5 text-center text-xs text-muted-foreground">暂无显式成员</p> : null}</div></div></Modal>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-[var(--overlay)] p-4" role="dialog" aria-modal="true" aria-label={title}><button type="button" className="absolute inset-0" onClick={onClose} aria-label="关闭" /><section className="relative w-full max-w-xl rounded-2xl border bg-card p-6 shadow-[var(--shadow-float)]"><header className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2><button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label="关闭"><X className="size-4" /></button></header>{children}</section></div>;
}
