"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FolderKey, Link2, LoaderCircle, RefreshCw } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { withBasePath } from "@/lib/base-path";

type Source = {
  source: {
    id: string;
    sourceType: "knowledge_space" | "document";
    knowledgeSpaceId: string | null;
    documentId: string | null;
  };
  spaceName: string | null;
  spaceType: "organization" | "department" | "project" | "restricted" | null;
  spaceVisibility: string | null;
};
type Space = {
  id: string;
  name: string;
  type: "organization" | "department" | "project" | "restricted";
  visibility: string;
};
type Department = { id: string; organizationId: string; name: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(
      (body as { error?: { message?: string } } | null)?.error?.message ??
        "知识来源操作失败",
    );
  }
  return body as T;
}

export function ProjectKnowledgeSourcesPanel({
  project,
}: {
  project: AuthorizedProjectSummary;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(project.departmentId ?? "");
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sourceResponse, spaceResponse, administrationResponse] = await Promise.all([
        request<{ sources: Source[] }>(
          `/api/projects/${encodeURIComponent(project.id)}/knowledge-sources`,
        ),
        request<{ knowledgeSpaces: Space[] }>("/api/knowledge-spaces"),
        request<{ departments: Department[] }>("/api/organizations"),
      ]);
      setSources(sourceResponse.sources);
      setSpaces(spaceResponse.knowledgeSpaces);
      setDepartments(
        administrationResponse.departments.filter(
          (item) => item.organizationId === project.organizationId,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [project.id, project.organizationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const mounted = useMemo(
    () => new Set(sources.map((item) => item.source.knowledgeSpaceId)),
    [sources],
  );
  const candidates = spaces.filter(
    (space) => !mounted.has(space.id) && space.visibility !== "private",
  );

  const mount = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await request(
        `/api/projects/${encodeURIComponent(project.id)}/knowledge-sources`,
        {
          method: "POST",
          body: JSON.stringify({
            sourceType: "knowledge_space",
            knowledgeSpaceId: selected,
          }),
        },
      );
      setSelected("");
      setFeedback("项目知识来源已挂载");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "挂载失败");
    } finally {
      setSaving(false);
    }
  };

  const saveDepartment = async () => {
    setSaving(true);
    setError(null);
    try {
      await request(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ departmentId: departmentId || null }),
      });
      setFeedback("项目所属部门已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold"><FolderKey className="size-4 text-primary" />项目知识来源</h3>
          <p className="mt-1 text-xs text-muted-foreground">公司、部门与受限空间只在服务端授权后才能挂载；选择来源只能缩小 AI 查询范围，不能扩大权限。</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-xs text-primary"><RefreshCw className="size-3" />刷新</button>
      </div>
      {loading ? <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />加载授权来源</div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {sources.map((item) => (
          <span key={item.source.id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-3 py-1.5 text-xs">
            <Link2 className="size-3 text-primary" />
            {item.spaceName ?? item.source.documentId ?? "资料"}
            <small className="text-muted-foreground">{item.spaceType ?? "document"}</small>
          </span>
        ))}
      </div>
      {project.projectRole === "project_manager" || project.projectRole === null ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="flex gap-2">
            <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="h-9 flex-1 rounded-lg border bg-background px-3 text-xs">
              <option value="">不绑定部门</option>
              {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button type="button" disabled={saving || departmentId === (project.departmentId ?? "")} onClick={() => void saveDepartment()} className="h-9 rounded-lg border px-3 text-xs disabled:opacity-50">保存部门</button>
          </div>
          <div className="flex gap-2">
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="h-9 flex-1 rounded-lg border bg-background px-3 text-xs">
            <option value="">选择已授权的公司或部门知识空间</option>
            {candidates.map((space) => <option key={space.id} value={space.id}>{space.name} · {space.type} · {space.visibility}</option>)}
          </select>
          <button type="button" disabled={!selected || saving} onClick={() => void mount()} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50">{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}挂载</button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      {feedback ? <p className="mt-3 flex items-center gap-1.5 text-xs text-success"><CheckCircle2 className="size-3.5" />{feedback}</p> : null}
    </section>
  );
}
