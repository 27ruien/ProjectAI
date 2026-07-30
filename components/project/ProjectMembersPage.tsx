"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { LoaderCircle, Trash2, UserPlus } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Member = { id: string; userId: string; role: "project_manager" | "project_member" | "viewer"; displayName: string; email: string };
const roleLabels: Record<Member["role"], string> = { project_manager: "项目经理", project_member: "项目成员", viewer: "只读成员" };

export function ProjectMembersPage({ project }: { project: AuthorizedProjectSummary }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("project_member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { const response = await fetch(withBasePath(`/api/projects/${project.id}/members`), { credentials: "include", cache: "no-store" }); const body = await response.json() as { members?: Member[]; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "成员列表加载失败"); setMembers(body.members ?? []); }, [project.id]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "成员列表加载失败")); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const add = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { const response = await fetch(withBasePath(`/api/projects/${project.id}/members`), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, role }) }); const body = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "添加失败"); setEmail(""); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "添加失败"); } finally { setBusy(false); } };
  const update = async (member: Member, nextRole: Member["role"]) => { setError(null); const response = await fetch(withBasePath(`/api/projects/${project.id}/members/${member.id}`), { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: nextRole }) }); if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; setError(body.error?.message ?? "角色更新失败"); return; } await load(); };
  const remove = async (member: Member) => { if (!window.confirm(`确认移除 ${member.displayName}？`)) return; const response = await fetch(withBasePath(`/api/projects/${project.id}/members/${member.id}`), { method: "DELETE", credentials: "include" }); if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; setError(body.error?.message ?? "移除失败"); return; } await load(); };
  return <div className="min-h-full"><ProjectContextHeader project={project} activeTab="members" /><div className="px-5 py-7 sm:px-6 lg:px-8"><header className="mb-5"><h2 className="text-lg font-semibold">成员与权限</h2><p className="mt-1 text-sm text-muted-foreground">成员关系和写入权限由服务端统一校验。</p></header>{project.permissions.canManageMembers ? <form onSubmit={add} className="mb-5 flex flex-wrap gap-2"><Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="成员邮箱" className="min-w-56 flex-1 sm:max-w-sm" /><Select value={role} onValueChange={(value) => setRole(value as Member["role"])}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <UserPlus />}添加成员</Button></form> : null}{error ? <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert> : null}<section className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader><TableRow><TableHead>成员</TableHead><TableHead>邮箱</TableHead><TableHead>角色</TableHead>{project.permissions.canManageMembers ? <TableHead className="w-12"><span className="sr-only">操作</span></TableHead> : null}</TableRow></TableHeader><TableBody>{members.map((member) => <TableRow key={member.id}><TableCell className="font-medium">{member.displayName}</TableCell><TableCell className="text-muted-foreground">{member.email}</TableCell><TableCell>{project.permissions.canManageMembers ? <Select value={member.role} onValueChange={(value) => void update(member, value as Member["role"])}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(roleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select> : roleLabels[member.role]}</TableCell>{project.permissions.canManageMembers ? <TableCell><Button variant="ghost" size="icon" onClick={() => void remove(member)} aria-label={`移除 ${member.displayName}`}><Trash2 /></Button></TableCell> : null}</TableRow>)}</TableBody></Table></section></div></div>;
}
