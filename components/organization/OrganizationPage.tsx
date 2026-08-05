"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Trash2,
  Plus,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/common";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useToast } from "@/components/common/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

async function request<T>(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown, suffix = ""): Promise<T> {
  const response = await fetch(withBasePath(`/api/organization/departments${suffix}`), {
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

export function OrganizationPage({ mode = "structure" }: { mode?: "structure" | "members" }) {
  const { toast } = useToast();
  const [payload, setPayload] = useState<OrganizationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Department | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  const remove = async (item: Department) => {
    setDeleting(true);
    try {
      const preview = await request<{ canDelete: boolean; dependencies: { childDepartments: number; activeMembers: number; projects: number; additionalKnowledgeSpaces: number; documents: number } }>("GET", undefined, `?previewDelete=${encodeURIComponent(item.id)}`);
      if (!preview.canDelete) {
        const values = preview.dependencies;
        setError(`“${item.name}”暂时不能删除：子部门 ${values.childDepartments}、成员 ${values.activeMembers}、项目 ${values.projects}、资料 ${values.documents}、额外资料空间 ${values.additionalKnowledgeSpaces}。请先处理这些关联项。`);
        setDeleteTarget(null);
        return;
      }
      await request("DELETE", { departmentId: item.id });
      toast("空部门已删除", "success");
      setDeleteTarget(null);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "部门删除失败"); }
    finally { setDeleting(false); }
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
              <span className="flex gap-1"><Button type="button" size="icon-sm" variant="ghost" onClick={() => setEditing(item)} aria-label={`编辑 ${item.name}`}><Pencil className="size-4" /></Button><Button type="button" size="icon-sm" variant="ghost" onClick={() => setDeleteTarget(item)} className="hover:bg-destructive-soft hover:text-destructive" aria-label={`删除 ${item.name}`}><Trash2 className="size-4" /></Button></span>
            </div>
            {!isCollapsed ? renderBranch(item.id) : null}
          </div>
        );
      });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Kivisense"
        title={mode === "structure" ? "组织架构" : "成员与角色"}
        description={mode === "structure" ? "四级部门树由 ProjectAI 管理。部门负责人不会自动获得超级管理员权限。" : "成员角色独立于部门层级；至少保留一名超级管理员。"}
        actions={
          mode === "structure" ? <Button type="button" onClick={() => setEditing("new")}>
            <Plus className="size-4" />新建部门
          </Button> : undefined
        }
      />
      <nav className="flex gap-4 border-b text-sm"><Link href="/organization/structure" className={mode === "structure" ? "border-b-2 border-primary pb-2 font-medium text-primary" : "pb-2 text-muted-foreground"}>组织结构</Link><Link href="/organization/members" className={mode === "members" ? "border-b-2 border-primary pb-2 font-medium text-primary" : "pb-2 text-muted-foreground"}>成员与角色</Link></nav>
      {mode === "structure" ? <label className="flex h-10 max-w-md items-center gap-2 rounded-lg border bg-card px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
        <Search className="size-4 text-muted-foreground" />
        <span className="sr-only">搜索部门</span>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-auto min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0" placeholder="搜索部门名称或编码" />
      </label> : null}
      {error ? <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive-soft p-4 text-sm text-destructive">{error}</div> : null}
      {loading ? (
        <div className="grid min-h-56 place-items-center rounded-xl border bg-card"><LoaderCircle className="size-6 animate-spin text-primary" /></div>
      ) : (
        mode === "members" ? (payload ? <MemberRoles members={payload.members} onSaved={load} /> : null) : <div className="grid items-start gap-5">
          <section className="space-y-2 rounded-2xl border bg-surface p-4" aria-label="部门树">
            {renderBranch(null)}
            {matchingIds?.size === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">未找到匹配部门</p> : null}
          </section>
        </div>
      )}
      {mode === "structure" && editing && payload ? (
        <DepartmentEditor
          department={editing === "new" ? null : editing}
          departments={departments}
          members={payload.members}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : null}
      <ConfirmDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }} title={`删除部门「${deleteTarget?.name ?? ""}」？`} description="系统会先检查子部门、成员、项目和资料依赖；仅空部门可以永久删除。" confirmLabel="删除部门" destructive busy={deleting} onConfirm={() => { if (deleteTarget) void remove(deleteTarget); }} />
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
  return <aside className="overflow-hidden rounded-2xl border bg-card"><header className="border-b p-4"><h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-primary" />组织成员角色</h2><p className="mt-1 text-xs text-muted-foreground">仅超级管理员可修改；至少保留一名超级管理员。</p></header>{error ? <p role="alert" className="m-3 rounded-lg bg-destructive-soft p-3 text-xs text-destructive">{error}</p> : null}<div className="divide-y">{members.map((member) => <div key={member.id} className="flex items-center gap-3 px-4 py-3"><span className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="size-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{member.displayName}</p></div><Select value={member.productRole} disabled={savingId === member.id} onValueChange={(value) => void save(member.id, value)}><SelectTrigger size="sm" className="w-32" aria-label={`${member.displayName} 角色`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="super_admin">超级管理员</SelectItem><SelectItem value="admin">管理员</SelectItem><SelectItem value="member">成员</SelectItem></SelectContent></Select></div>)}</div></aside>;
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
  const [name, setName] = useState(department?.name ?? "");
  const [code, setCode] = useState("");
  const [parentDepartmentId, setParentDepartmentId] = useState(department?.parentDepartmentId ?? "root");
  const [headUserIds, setHeadUserIds] = useState<string[]>(department?.headUserIds ?? []);
  const [sortOrder, setSortOrder] = useState(String(department?.sortOrder ?? 0));
  const [status, setStatus] = useState(department?.status ?? "active");
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        ...(department ? { departmentId: department.id } : {}),
        name,
        ...(department ? {} : { code }),
        parentDepartmentId: parentDepartmentId === "root" ? null : parentDepartmentId,
        headUserIds,
        sortOrder: Number(sortOrder || 0),
        ...(department ? { status } : {}),
      };
      await onSave(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      setSubmitting(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onCancel(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="size-5 text-primary" />{department ? "编辑部门" : "新建部门"}</DialogTitle><DialogDescription>最大四级；移动时服务端会检查循环和子树深度。</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5"><Label htmlFor="department-name">部门名称</Label><Input id="department-name" value={name} minLength={2} onChange={(event) => setName(event.target.value)} /></div>
          {!department ? <div className="grid gap-1.5"><Label htmlFor="department-code">部门编码</Label><Input id="department-code" value={code} minLength={2} pattern="(?:[A-Z0-9]|-)+" className="uppercase" onChange={(event) => setCode(event.target.value.toUpperCase())} /></div> : null}
          <div className="grid gap-1.5"><Label>上级部门</Label><Select value={parentDepartmentId} onValueChange={setParentDepartmentId}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="root">一级部门</SelectItem>{departments.filter((item) => item.id !== department?.id && item.status === "active").map((item) => <SelectItem key={item.id} value={item.id}>{"—".repeat(item.level - 1)} {item.name}</SelectItem>)}</SelectContent></Select></div>
          <fieldset><legend className="text-sm font-medium">负责人（可多选）</legend><div className="mt-2 grid max-h-32 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">{members.map((member) => { const checked = headUserIds.includes(member.id); return <Label key={member.id} className="flex items-center gap-2 font-normal"><Checkbox checked={checked} onCheckedChange={(next) => setHeadUserIds((current) => next === true ? [...new Set([...current, member.id])] : current.filter((id) => id !== member.id))} />{member.displayName}</Label>; })}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label htmlFor="department-sort">排序</Label><Input id="department-sort" type="number" min={0} max={100000} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></div>{department ? <div className="grid gap-1.5"><Label>状态</Label><Select value={status} onValueChange={(value) => setStatus(value as Department["status"])}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="inactive">停用</SelectItem></SelectContent></Select></div> : null}</div>
          {error ? <p role="alert" className="rounded-lg bg-destructive-soft p-3 text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>取消</Button><Button type="button" disabled={submitting || name.trim().length < 2 || (!department && code.trim().length < 2)} onClick={() => void submit()}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}保存</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
