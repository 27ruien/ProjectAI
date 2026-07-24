"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/common";
import { useToast } from "@/components/common/toast";
import { withBasePath } from "@/lib/base-path";

type Department = {
  id: string;
  parentDepartmentId: string | null;
  level: number;
  name: string;
  code: string;
  status: "active" | "inactive";
  headUserIds: string[];
  sortOrder: number;
};

type Member = { id: string; displayName: string; productRole: string };
type OrganizationPayload = {
  organization: { id: string; name: string };
  departments: Department[];
  members: Member[];
};

async function request<T>(method: "GET" | "POST" | "PATCH", body?: unknown): Promise<T> {
  const response = await fetch(withBasePath("/api/organization/departments"), {
    method,
    credentials: "include",
    cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error((payload as { error?: { message?: string } } | null)?.error?.message ?? "组织架构操作失败");
  }
  return payload as T;
}

export function OrganizationPage() {
  const { toast } = useToast();
  const [payload, setPayload] = useState<OrganizationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Department | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayload(await request<OrganizationPayload>("GET"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "组织架构加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const departments = useMemo(() => payload?.departments ?? [], [payload?.departments]);
  const matchingIds = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return null;
    const matches = new Set<string>();
    for (const item of departments) {
      if (`${item.name}${item.code}`.toLocaleLowerCase("zh-CN").includes(keyword)) {
        matches.add(item.id);
        let parentId = item.parentDepartmentId;
        while (parentId) {
          matches.add(parentId);
          parentId = departments.find((candidate) => candidate.id === parentId)?.parentDepartmentId ?? null;
        }
      }
    }
    return matches;
  }, [departments, query]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, Department[]>();
    for (const item of departments) {
      const list = map.get(item.parentDepartmentId) ?? [];
      list.push(item);
      map.set(item.parentDepartmentId, list);
    }
    return map;
  }, [departments]);

  const save = async (body: Record<string, unknown>) => {
    try {
      await request(editing === "new" ? "POST" : "PATCH", body);
      toast(editing === "new" ? "部门已创建" : "部门已更新", "success");
      setEditing(null);
      await load();
    } catch (caught) {
      throw caught;
    }
  };

  const renderBranch = (parentId: string | null): React.ReactNode =>
    (childrenByParent.get(parentId) ?? [])
      .filter((item) => !matchingIds || matchingIds.has(item.id))
      .map((item) => {
        const hasChildren = (childrenByParent.get(item.id) ?? []).length > 0;
        const isCollapsed = collapsed.has(item.id) && !matchingIds;
        const heads = item.headUserIds
          .map((id) => payload?.members.find((member) => member.id === id)?.displayName)
          .filter(Boolean)
          .join("、");
        return (
          <div key={item.id} className="space-y-2">
            <div
              className="grid min-h-14 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border bg-card px-3 py-2.5"
              style={{ marginLeft: `${(item.level - 1) * 24}px` }}
            >
              <button
                type="button"
                disabled={!hasChildren}
                onClick={() => setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })}
                aria-label={isCollapsed ? `展开 ${item.name}` : `折叠 ${item.name}`}
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-20"
              >
                {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="truncate text-sm">{item.name}</strong>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">L{item.level}</span>
                  {item.status === "inactive" ? <span className="rounded-full bg-destructive-soft px-2 py-0.5 text-[10px] text-destructive">已停用</span> : null}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {item.code}{heads ? ` · 负责人：${heads}` : " · 暂无负责人"}
                </p>
              </div>
              <button type="button" onClick={() => setEditing(item)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`编辑 ${item.name}`}>
                <Pencil className="size-4" />
              </button>
            </div>
            {!isCollapsed ? renderBranch(item.id) : null}
          </div>
        );
      });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Kivisense"
        title="组织架构"
        description="四级部门树由 ProjectAI 管理。部门负责人不会自动获得超级管理员权限。"
        actions={
          <button type="button" onClick={() => setEditing("new")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">
            <Plus className="size-4" />新建部门
          </button>
        }
      />
      <label className="flex h-10 max-w-md items-center gap-2 rounded-lg border bg-card px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
        <Search className="size-4 text-muted-foreground" />
        <span className="sr-only">搜索部门</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="搜索部门名称或编码" />
      </label>
      {error ? <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive-soft p-4 text-sm text-destructive">{error}</div> : null}
      {loading ? (
        <div className="grid min-h-56 place-items-center rounded-xl border bg-card"><LoaderCircle className="size-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-2 rounded-2xl border bg-surface p-4" aria-label="部门树">
            {renderBranch(null)}
            {matchingIds?.size === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">未找到匹配部门</p> : null}
          </section>
          {payload ? <MemberRoles members={payload.members} onSaved={load} /> : null}
        </div>
      )}
      {editing && payload ? (
        <DepartmentEditor
          department={editing === "new" ? null : editing}
          departments={departments}
          members={payload.members}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
    </div>
  );
}

function MemberRoles({ members, onSaved }: { members: Member[]; onSaved: () => Promise<void> }) {
  const { toast } = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (userId: string, productRole: string) => {
    setSavingId(userId);
    setError(null);
    try {
      const response = await fetch(withBasePath("/api/organization/members"), {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, productRole }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "角色更新失败");
      toast("成员角色已更新", "success");
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "角色更新失败");
    } finally {
      setSavingId(null);
    }
  };
  return <aside className="overflow-hidden rounded-2xl border bg-card"><header className="border-b p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-primary" />组织成员角色</h2><p className="mt-1 text-xs text-muted-foreground">仅超级管理员可修改；至少保留一名超级管理员。</p></header>{error ? <p role="alert" className="m-3 rounded-lg bg-destructive-soft p-3 text-xs text-destructive">{error}</p> : null}<div className="divide-y">{members.map((member) => <div key={member.id} className="flex items-center gap-3 px-4 py-3"><span className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{member.displayName}</p></div><select aria-label={`${member.displayName} 角色`} value={member.productRole} disabled={savingId === member.id} onChange={(event) => void save(member.id, event.target.value)} className="h-8 rounded-lg border bg-background px-2 text-[11px]"><option value="super_admin">超级管理员</option><option value="admin">管理员</option><option value="member">成员</option></select></div>)}</div></aside>;
}

function DepartmentEditor({
  department,
  departments,
  members,
  onCancel,
  onSave,
}: {
  department: Department | null;
  departments: Department[];
  members: Member[];
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        ...(department ? { departmentId: department.id } : {}),
        name: String(form.get("name") || ""),
        ...(department ? {} : { code: String(form.get("code") || "") }),
        parentDepartmentId: String(form.get("parentDepartmentId") || "") || null,
        headUserIds: form.getAll("headUserIds").map(String),
        sortOrder: Number(form.get("sortOrder") || 0),
        ...(department ? { status: String(form.get("status")) } : {}),
      };
      await onSave(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      setSubmitting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[var(--overlay)] p-4" role="dialog" aria-modal="true" aria-label={department ? "编辑部门" : "新建部门"}>
      <button type="button" className="absolute inset-0" onClick={onCancel} aria-label="关闭" />
      <form onSubmit={submit} className="relative w-full max-w-lg space-y-4 rounded-2xl border bg-card p-6 shadow-[var(--shadow-float)]">
        <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="size-5" /></span><div><h2 className="text-base font-semibold">{department ? "编辑部门" : "新建部门"}</h2><p className="text-xs text-muted-foreground">最大四级；移动时服务端会检查循环和子树深度。</p></div></div>
        <label className="block text-xs font-medium">部门名称<input name="name" required minLength={2} defaultValue={department?.name} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:border-primary" /></label>
        {!department ? <label className="block text-xs font-medium">部门编码<input name="code" required minLength={2} pattern="[A-Z0-9-]+" className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm uppercase outline-none focus:border-primary" /></label> : null}
        <label className="block text-xs font-medium">上级部门<select name="parentDepartmentId" defaultValue={department?.parentDepartmentId ?? ""} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">一级部门</option>{departments.filter((item) => item.id !== department?.id && item.status === "active").map((item) => <option key={item.id} value={item.id}>{"—".repeat(item.level - 1)} {item.name}</option>)}</select></label>
        <fieldset><legend className="text-xs font-medium">负责人（可多选）</legend><div className="mt-2 grid max-h-32 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">{members.map((member) => <label key={member.id} className="flex items-center gap-2 text-xs"><input type="checkbox" name="headUserIds" value={member.id} defaultChecked={department?.headUserIds.includes(member.id)} />{member.displayName}</label>)}</div></fieldset>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">排序<input name="sortOrder" type="number" min={0} max={100000} defaultValue={department?.sortOrder ?? 0} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm" /></label>{department ? <label className="block text-xs font-medium">状态<select name="status" defaultValue={department.status} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="active">启用</option><option value="inactive">停用</option></select></label> : null}</div>
        {error ? <p role="alert" className="rounded-lg bg-destructive-soft p-3 text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="h-9 rounded-lg border px-4 text-xs">取消</button><button disabled={submitting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60">{submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}保存</button></div>
      </form>
    </div>
  );
}
