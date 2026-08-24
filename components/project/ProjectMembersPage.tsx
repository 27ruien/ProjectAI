"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Search, UserPlus } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { ProjectEditDialog } from "./ProjectEditDialog";
import { initials } from "./mock-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/common/toast";

type Member = {
  id: string;
  userId: string;
  role: "project_manager" | "project_member" | "viewer";
  displayName: string;
  email: string;
  status: "active" | "disabled";
  createdAt: string;
};

const roleLabels: Record<Member["role"], string> = {
  project_manager: "项目经理",
  project_member: "项目成员",
  viewer: "只读成员",
};

export function ProjectMembersPage({ project }: { project: AuthorizedProjectSummary }) {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("project_member");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(withBasePath(`/api/projects/${project.id}/members`), { credentials: "include", cache: "no-store" });
    const body = await response.json() as { members?: Member[]; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "成员列表加载失败");
    setMembers(body.members ?? []);
  }, [project.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => setError(caught instanceof Error ? caught.message : "成员列表加载失败"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return members.filter((member) =>
      (!keyword || `${member.displayName} ${member.email}`.toLocaleLowerCase("zh-CN").includes(keyword)) &&
      (roleFilter === "all" || member.role === roleFilter),
    );
  }, [members, query, roleFilter]);
  const managerCount = members.filter((member) => member.role === "project_manager").length;

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}/members`), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "添加失败");
      setEmail("");
      setAddOpen(false);
      await load();
      toast("成员已添加");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "添加失败");
    } finally {
      setBusy(false);
    }
  };

  const update = async (member: Member, nextRole: Member["role"]) => {
    if (member.role === "project_manager" && managerCount === 1 && nextRole !== "project_manager") {
      setError("项目必须至少保留一名项目经理，请先指定另一名项目经理。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}/members/${member.id}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "角色更新失败");
      }
      await load();
      toast("成员角色已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "角色更新失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}/members/${removeTarget.id}`), { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const body = await response.json() as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "移除失败");
      }
      setRemoveTarget(null);
      await load();
      toast("成员已移除");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full">
      <ProjectContextHeader
        project={project}
        activeTab="members"
        actions={project.permissions.canEditProject ? <ProjectEditDialog project={project} /> : undefined}
      />
      <main className="mx-auto max-w-[1280px] space-y-4 px-4 py-7 sm:px-6 lg:px-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{members.length}</span> 名成员 · 管理此项目的访问范围和成员角色</p>
          {project.permissions.canManageMembers ? <Button onClick={() => setAddOpen(true)}><UserPlus />添加成员</Button> : null}
        </header>

        {error ? <Alert variant="destructive"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <label className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" aria-label="搜索姓名或邮箱" placeholder="搜索姓名或邮箱" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          </label>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full sm:w-44" aria-label="按角色筛选"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">全部角色</SelectItem><SelectItem value="project_manager">项目经理</SelectItem><SelectItem value="project_member">项目成员</SelectItem><SelectItem value="viewer">只读成员</SelectItem></SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden border-y">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader className="bg-muted/25"><TableRow><TableHead>姓名</TableHead><TableHead>邮箱</TableHead><TableHead>角色</TableHead><TableHead>状态</TableHead><TableHead>加入时间</TableHead>{project.permissions.canManageMembers ? <TableHead className="w-12"><span className="sr-only">操作</span></TableHead> : null}</TableRow></TableHeader>
              <TableBody>
                {filtered.map((member) => {
                  const onlyManager = member.role === "project_manager" && managerCount === 1;
                  return <TableRow key={member.id} className="h-[52px]">
                    <TableCell><div className="flex items-center gap-2"><Avatar className="size-7"><AvatarFallback>{initials(member.displayName)}</AvatarFallback></Avatar><span className="font-medium">{member.displayName}</span></div></TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell>{project.permissions.canManageMembers ? <Select value={member.role} disabled={busy} onValueChange={(value) => void update(member, value as Member["role"])}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project_manager">项目经理</SelectItem><SelectItem value="project_member" disabled={onlyManager}>项目成员</SelectItem><SelectItem value="viewer" disabled={onlyManager}>只读成员</SelectItem></SelectContent></Select> : roleLabels[member.role]}</TableCell>
                    <TableCell><Badge variant="outline" className={member.status === "active" ? "border-success/20 bg-success-soft text-success" : "text-muted-foreground"}>{member.status === "active" ? "有效" : "已停用"}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{new Date(member.createdAt).toLocaleDateString("zh-CN")}</TableCell>
                    {project.permissions.canManageMembers ? <TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`${member.displayName} 操作`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={onlyManager} variant="destructive" onSelect={() => setRemoveTarget(member)}>移除成员</DropdownMenuItem>{onlyManager ? <><DropdownMenuSeparator /><p className="max-w-52 px-2 py-1 text-xs text-muted-foreground">唯一项目经理不能移除，请先指定另一名项目经理。</p></> : null}</DropdownMenuContent></DropdownMenu></TableCell> : null}
                  </TableRow>;
                })}
                {!filtered.length ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">没有匹配的成员</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </div>
        </div>
      </main>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader><DialogTitle>添加项目成员</DialogTitle><DialogDescription>只能添加组织内已激活账号；实际权限由服务端校验。</DialogDescription></DialogHeader>
          <form onSubmit={add} className="grid gap-4">
            <div className="grid gap-2"><Label htmlFor="member-email">成员邮箱</Label><Input id="member-email" required type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} placeholder="name@company.com" /></div>
            <div className="grid gap-2"><Label>角色</Label><Select value={role} onValueChange={(value) => setRole(value as Member["role"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project_manager">项目经理</SelectItem><SelectItem value="project_member">项目成员</SelectItem><SelectItem value="viewer">只读成员</SelectItem></SelectContent></Select></div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>取消</Button><Button type="submit" disabled={busy || !email.trim()}>{busy ? "正在添加…" : "添加成员"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => { if (!open && !busy) setRemoveTarget(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>移除 {removeTarget?.displayName}？</AlertDialogTitle><AlertDialogDescription>移除后该成员将无法继续访问此项目，但不会删除该用户账号。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void remove(); }} className="bg-destructive text-white hover:bg-destructive/90">{busy ? "正在移除…" : "确认移除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
