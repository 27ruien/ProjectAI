"use client";

import { LoaderCircle, Trash2, UserPlus } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { ProjectContextHeader } from "./ProjectContextHeader";

type Member = { id: string; userId: string; role: "project_manager" | "project_member" | "viewer"; displayName: string; email: string };

export function ProjectMembersPage({ project }: { project: AuthorizedProjectSummary }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("project_member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch(withBasePath(`/api/projects/${project.id}/members`), { credentials: "include", cache: "no-store" });
    const body = await response.json() as { members?: Member[]; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "成员列表加载失败");
    setMembers(body.members ?? []);
  }, [project.id]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "成员列表加载失败")); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const add = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { const response = await fetch(withBasePath(`/api/projects/${project.id}/members`), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) }); const body = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "添加失败"); setEmail(""); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "添加失败"); } finally { setBusy(false); }
  };
  const update = async (member: Member, nextRole: Member["role"]) => { setError(null); const response = await fetch(withBasePath(`/api/projects/${project.id}/members/${member.id}`), { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: nextRole }) }); if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; setError(body.error?.message ?? "角色更新失败"); return; } await load(); };
  const remove = async (member: Member) => { if (!window.confirm(`确认移除 ${member.displayName}？`)) return; const response = await fetch(withBasePath(`/api/projects/${project.id}/members/${member.id}`), { method: "DELETE", credentials: "include" }); if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; setError(body.error?.message ?? "移除失败"); return; } await load(); };
  return <div className="min-h-full"><ProjectContextHeader project={project} activeTab="members" /><div className="px-5 py-6 lg:px-8"><section className="rounded-xl border bg-card"><div className="border-b p-5"><h2 className="font-semibold">成员与权限</h2><p className="mt-1 text-sm text-muted-foreground">项目权限由服务端成员关系强制执行。</p>{project.permissions.canManageMembers ? <form onSubmit={add} className="mt-4 flex flex-wrap gap-2"><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="成员邮箱" className="h-9 min-w-64 flex-1 rounded-lg border bg-background px-3 text-sm" /><select value={role} onChange={(event) => setRole(event.target.value as Member["role"])} className="h-9 rounded-lg border bg-background px-3 text-sm"><option value="project_manager">项目经理</option><option value="project_member">项目成员</option><option value="viewer">只读成员</option></select><button disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}添加</button></form> : null}{error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}</div><div className="divide-y">{members.map((member) => <div key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.displayName}</p><p className="truncate text-xs text-muted-foreground">{member.email}</p></div>{project.permissions.canManageMembers ? <select value={member.role} onChange={(event) => void update(member, event.target.value as Member["role"])} className="h-8 rounded-lg border bg-background px-2 text-xs"><option value="project_manager">项目经理</option><option value="project_member">项目成员</option><option value="viewer">只读成员</option></select> : <span className="text-xs text-muted-foreground">{{ project_manager: "项目经理", project_member: "项目成员", viewer: "只读成员" }[member.role]}</span>}{project.permissions.canManageMembers ? <button onClick={() => void remove(member)} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive-soft hover:text-destructive" aria-label="移除成员"><Trash2 className="size-4" /></button> : null}</div>)}</div></section></div></div>;
}
