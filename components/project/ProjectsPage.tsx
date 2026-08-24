"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, Plus } from "lucide-react";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { dateLabel, statusLabel } from "./mock-view";
import { CreateProjectDialog } from "./CreateProjectPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, PageShell } from "@/components/common";

const statusTone: Record<string, string> = {
  planning: "border-border bg-muted text-muted-foreground",
  active: "border-primary/20 bg-primary/10 text-primary",
  completed: "border-success/20 bg-success-soft text-success",
};

export function ProjectsPage({ viewer }: { viewer: ViewerContext }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return viewer.projects.filter((project) =>
      (!keyword || `${project.name} ${project.clientName} ${project.description} ${project.managerDisplayName ?? ""}`.toLocaleLowerCase("zh-CN").includes(keyword)) &&
      (status === "all" || project.status === status),
    );
  }, [query, status, viewer.projects]);

  return (
    <PageShell width="data" className="min-h-full max-w-[1280px] space-y-5 py-7 lg:px-10" data-testid="projects-page">
      <PageHeader
        title="项目"
        description="管理你参与的项目及其知识空间。"
        actions={viewer.canCreateProject ? <CreateProjectDialog managerName={viewer.user.displayName} trigger={<Button><Plus />新建项目</Button>} /> : null}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索项目" aria-label="搜索项目" className="sm:max-w-sm" />
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="sm:w-40" aria-label="按状态筛选项目"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="planning">规划中</SelectItem><SelectItem value="active">进行中</SelectItem><SelectItem value="completed">已完成</SelectItem></SelectContent></Select>
      </div>
      <div className="border-y">
        {filtered.length ? (
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader className="bg-muted/25"><TableRow><TableHead>项目</TableHead><TableHead>状态</TableHead><TableHead>成员</TableHead><TableHead>知识库</TableHead><TableHead>负责人</TableHead><TableHead>更新时间</TableHead></TableRow></TableHeader>
              <TableBody>{filtered.map((project) => (
                <TableRow key={project.id} className="h-[52px] cursor-pointer" tabIndex={0} onClick={() => router.push(`/projects/${project.id}/knowledge`)} onKeyDown={(event) => { if (event.key === "Enter") router.push(`/projects/${project.id}/knowledge`); }}>
                  <TableCell><Link href={`/projects/${project.id}/knowledge`} onClick={(event) => event.stopPropagation()} className="font-medium text-foreground hover:text-primary hover:underline">{project.name}</Link><p className="mt-0.5 max-w-80 truncate text-[11px] text-muted-foreground">{project.clientName}{project.description ? ` · ${project.description}` : ""}</p></TableCell>
                  <TableCell><Badge variant="outline" className={statusTone[project.status]}>{statusLabel(project.status)}</Badge></TableCell>
                  <TableCell>{project.memberCount}</TableCell>
                  <TableCell><Badge variant="outline">{project.knowledgeStatus === "ready" ? "可用" : project.knowledgeStatus === "failed" ? "需重试" : "创建中"}</Badge></TableCell>
                  <TableCell>{project.managerDisplayName ?? "待分配"}</TableCell>
                  <TableCell>{dateLabel(project.updatedAt)}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex min-h-44 flex-col items-center justify-center text-center"><FolderKanban className="size-6 text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">没有匹配的项目。</p></div>
        )}
      </div>
    </PageShell>
  );
}
