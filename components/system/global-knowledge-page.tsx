"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  FolderKey,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { Badge, PageHeader } from "@/components/common";
import { withBasePath } from "@/lib/base-path";
import type { ViewerContext } from "@/lib/auth/ui-types";

type Organization = { id: string; name: string; slug: string; isActive: boolean };
type Department = {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string;
};
type KnowledgeSpace = {
  id: string;
  organizationId: string;
  departmentId: string | null;
  projectId: string | null;
  type: "organization" | "department" | "project" | "restricted";
  visibility:
    | "private"
    | "organization_shared"
    | "department_shared"
    | "restricted";
  name: string;
  description: string;
};
type Grant = {
  id: string;
  knowledgeSpaceId: string;
  subjectType: string;
  subjectId: string;
  permission: string;
  effect: "allow" | "deny";
};
type PermissionAudit = {
  id: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
};
type AdministrationData = {
  organizations: Organization[];
  departments: Department[];
  knowledgeSpaces: KnowledgeSpace[];
  grants: Grant[];
  permissionAudits: PermissionAudit[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...init.headers }
      : init?.headers,
  });
  const body = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(
      (body as { error?: { message?: string } } | null)?.error?.message ??
        "知识空间操作失败",
    );
  }
  return body as T;
}

const typeLabel = {
  organization: "公司",
  department: "部门",
  project: "项目",
  restricted: "受限",
} as const;

const visibilityLabel = {
  private: "私有",
  organization_shared: "公司共享",
  department_shared: "部门共享",
  restricted: "显式授权",
} as const;

export function GlobalKnowledgePage({ viewer }: { viewer: ViewerContext }) {
  const [data, setData] = useState<AdministrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [panel, setPanel] = useState<
    "organization" | "department" | "member" | "space" | "grant" | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<AdministrationData>("/api/organizations"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const departmentById = useMemo(
    () => new Map(data?.departments.map((item) => [item.id, item]) ?? []),
    [data],
  );
  const mutate = async (path: string, body: unknown, success: string) => {
    setError(null);
    await api(path, { method: "POST", body: JSON.stringify(body) });
    setFeedback(success);
    setPanel(null);
    await load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organization Knowledge"
        title="组织、部门与知识空间"
        description="服务端统一计算组织、部门、项目、角色和用户授权；显式拒绝优先，查看与下载权限相互独立。"
      />

      <div className="flex flex-wrap gap-2">
        {viewer.user.systemRole === "system_admin" ? (
          <ActionButton label="新建组织" onClick={() => setPanel("organization")} />
        ) : null}
        <ActionButton label="新建部门" onClick={() => setPanel("department")} />
        <ActionButton label="管理部门成员" onClick={() => setPanel("member")} />
        <ActionButton label="新建知识空间" onClick={() => setPanel("space")} />
        <ActionButton label="新增授权规则" onClick={() => setPanel("grant")} />
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs"
        >
          <RefreshCw className="size-3.5" />刷新
        </button>
      </div>

      {panel && data ? (
        <MutationPanel
          kind={panel}
          data={data}
          onCancel={() => setPanel(null)}
          onSubmit={mutate}
        />
      ) : null}

      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive-soft p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="grid min-h-56 place-items-center rounded-xl border bg-card">
          <LoaderCircle className="size-6 animate-spin text-primary" />
        </div>
      ) : data ? (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <Metric icon={Building2} label="可见组织" value={data.organizations.length} />
            <Metric icon={UsersRound} label="可见部门" value={data.departments.length} />
            <Metric icon={FolderKey} label="授权知识空间" value={data.knowledgeSpaces.length} />
          </section>

          <section className="app-card overflow-hidden">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">知识空间</h2>
              <p className="mt-1 text-xs text-muted-foreground">只展示当前用户可见的空间；无权空间的名称和存在性不会返回浏览器。</p>
            </div>
            <div className="divide-y">
              {data.knowledgeSpaces.map((space) => (
                <div key={space.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1.4fr_120px_140px_1fr] md:items-center">
                  <div>
                    <p className="text-sm font-medium">{space.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{space.description || "暂无说明"}</p>
                  </div>
                  <Badge tone="primary">{typeLabel[space.type]}</Badge>
                  <Badge tone={space.visibility === "restricted" ? "warning" : "success"}>
                    {visibilityLabel[space.visibility]}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    {space.departmentId
                      ? departmentById.get(space.departmentId)?.name ?? "部门空间"
                      : space.projectId
                        ? `项目 ${space.projectId}`
                        : "组织级"}
                  </p>
                </div>
              ))}
              {!data.knowledgeSpaces.length ? (
                <p className="p-8 text-center text-sm text-muted-foreground">当前没有可见知识空间。</p>
              ) : null}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="app-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><Building2 className="size-4 text-primary" />部门</h2>
              <div className="mt-4 space-y-2">
                {data.departments.map((item) => (
                  <div key={item.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3"><strong className="text-xs">{item.name}</strong><span className="font-mono text-[10px] text-muted-foreground">{item.code}</span></div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.description || "暂无说明"}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="app-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-primary" />权限规则审计视图</h2>
              <div className="mt-4 space-y-2">
                {data.grants.map((grant) => (
                  <div key={grant.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border p-3 text-xs">
                    <Badge tone={grant.effect === "deny" ? "danger" : "success"}>{grant.effect === "deny" ? "拒绝" : "允许"}</Badge>
                    <span className="truncate">{grant.subjectType}:{grant.subjectId}</span>
                    <code>{grant.permission}</code>
                  </div>
                ))}
                {!data.grants.length ? <p className="text-xs text-muted-foreground">没有可管理的显式规则；默认拒绝和内置项目角色规则仍然生效。</p> : null}
              </div>
            </div>
          </section>
          <section className="app-card overflow-hidden">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">权限变更审计</h2>
              <p className="mt-1 text-xs text-muted-foreground">只向有权管理员展示授权和成员关系变更，不包含密码、Session 或文件正文。</p>
            </div>
            <div className="divide-y">
              {data.permissionAudits.map((audit) => (
                <div key={audit.id} className="grid gap-2 px-5 py-3 text-xs md:grid-cols-[180px_1fr_180px]">
                  <code>{audit.eventType}</code>
                  <span className="truncate text-muted-foreground">{audit.resourceType}:{audit.resourceId}</span>
                  <time className="text-muted-foreground">{new Date(audit.createdAt).toLocaleString("zh-CN")}</time>
                </div>
              ))}
              {!data.permissionAudits.length ? <p className="p-5 text-xs text-muted-foreground">当前角色没有可查看的权限审计记录。</p> : null}
            </div>
          </section>
        </>
      ) : null}

      {feedback ? (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-xs shadow-xl">
          <CheckCircle2 className="size-4 text-success" />{feedback}
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" />{label}</button>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: number }) {
  return <div className="app-card flex items-center gap-3 p-4"><span className="grid size-10 place-items-center rounded-xl bg-primary/8 text-primary"><Icon className="size-5" /></span><div><strong className="text-lg">{value}</strong><p className="text-xs text-muted-foreground">{label}</p></div></div>;
}

function MutationPanel({ kind, data, onCancel, onSubmit }: {
  kind: "organization" | "department" | "member" | "space" | "grant";
  data: AdministrationData;
  onCancel: () => void;
  onSubmit: (path: string, body: unknown, success: string) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (kind === "organization") {
        await onSubmit("/api/organizations", { name: values.name, slug: values.slug }, "组织已创建");
      } else if (kind === "department") {
        await onSubmit(`/api/organizations/${encodeURIComponent(String(values.organizationId))}/departments`, { name: values.name, code: values.code, description: values.description }, "部门已创建");
      } else if (kind === "member") {
        await onSubmit(`/api/departments/${encodeURIComponent(String(values.departmentId))}/members`, { userId: values.userId, role: values.role }, "部门成员已更新");
      } else if (kind === "space") {
        const type = String(values.type);
        await onSubmit("/api/knowledge-spaces", {
          organizationId: values.organizationId,
          departmentId: type === "department" || type === "restricted" ? values.departmentId || null : null,
          projectId: type === "project" ? values.projectId || null : null,
          type,
          visibility: values.visibility,
          name: values.name,
          description: values.description,
        }, "知识空间已创建");
      } else {
        await onSubmit(`/api/knowledge-spaces/${encodeURIComponent(String(values.knowledgeSpaceId))}/grants`, {
          subjectType: values.subjectType,
          subjectId: values.subjectId,
          permission: values.permission,
          effect: values.effect,
        }, "授权规则已创建");
      }
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };
  return <form onSubmit={submit} className="app-card space-y-3 p-5">
    <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4 text-primary" />{kind === "organization" ? "新建组织" : kind === "department" ? "新建部门" : kind === "member" ? "部门成员" : kind === "space" ? "新建知识空间" : "新增授权规则"}</h2><button type="button" onClick={onCancel} className="text-xs text-muted-foreground">取消</button></div>
    <div className="grid gap-3 md:grid-cols-2">
      {kind === "organization" ? <><Field name="name" label="组织名称" /><Field name="slug" label="Slug" /></> : null}
      {kind === "department" ? <><Select name="organizationId" label="组织" options={data.organizations.map((item) => [item.id, item.name])} /><Field name="name" label="部门名称" /><Field name="code" label="部门编码" /><Field name="description" label="说明" /></> : null}
      {kind === "member" ? <><Select name="departmentId" label="部门" options={data.departments.map((item) => [item.id, item.name])} /><Field name="userId" label="Account ID" /><Select name="role" label="部门角色" options={[["department_member", "部门成员"], ["department_admin", "部门管理员"]]} /></> : null}
      {kind === "space" ? <><Select name="organizationId" label="组织" options={data.organizations.map((item) => [item.id, item.name])} /><Select name="type" label="类型" options={Object.entries(typeLabel)} /><Select name="visibility" label="可见范围" options={Object.entries(visibilityLabel)} /><Select name="departmentId" label="部门（按需）" options={[["", "不绑定"], ...data.departments.map((item) => [item.id, item.name] as [string, string])]} /><Field name="projectId" label="Project ID（项目空间）" /><Field name="name" label="空间名称" /><Field name="description" label="说明" /></> : null}
      {kind === "grant" ? <><Select name="knowledgeSpaceId" label="知识空间" options={data.knowledgeSpaces.map((item) => [item.id, item.name])} /><Select name="subjectType" label="授权对象" options={[["user", "用户"], ["project", "项目"], ["department", "部门"], ["organization", "组织"], ["role", "角色"]]} /><Field name="subjectId" label="对象 ID / Role" /><Select name="permission" label="权限" options={["view", "download", "upload", "edit_metadata", "manage_versions", "archive", "manage_permissions", "manage_members"].map((item) => [item, item])} /><Select name="effect" label="效果" options={[["allow", "允许"], ["deny", "拒绝"]]} /></> : null}
    </div>
    {formError ? <p className="text-xs text-destructive">{formError}</p> : null}
    <button disabled={submitting} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50">{submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}保存</button>
  </form>;
}

function Field({ name, label }: { name: string; label: string }) {
  return <label><span className="mb-1 block text-xs text-muted-foreground">{label}</span><input name={name} required={!label.includes("按需") && !label.includes("说明") && !label.includes("Project ID")} className="h-9 w-full rounded-lg border bg-background px-3 text-xs" /></label>;
}

function Select({ name, label, options }: { name: string; label: string; options: Array<[string, string]> }) {
  return <label><span className="mb-1 block text-xs text-muted-foreground">{label}</span><select name={name} className="h-9 w-full rounded-lg border bg-background px-3 text-xs">{options.map(([value, text]) => <option key={`${name}-${value}`} value={value}>{text}</option>)}</select></label>;
}
