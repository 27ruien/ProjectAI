"use client";

import Link from "next/link";
import { ChevronRight, Eye, Users } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { dateLabel, statusClasses, statusLabel } from "./mock-view";

export type ProjectTab = "overview" | "files" | "requirements" | "members";

const tabs: { id: ProjectTab; label: string; path: string }[] = [
  { id: "overview", label: "概览", path: "overview" },
  { id: "files", label: "项目资料", path: "files" },
  { id: "requirements", label: "需求文档", path: "requirements" },
  { id: "members", label: "成员与权限", path: "members" },
];

export function ProjectContextHeader({ project, activeTab }: { project: AuthorizedProjectSummary; activeTab: ProjectTab }) {
  return <div className="border-b border-border bg-card">
    <div className="px-5 pb-0 pt-5 lg:px-8">
      <div className="mb-4 min-w-0">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Link href="/projects" className="hover:text-foreground">项目</Link><ChevronRight className="size-3.5" /><span className="truncate">{project.name}</span></div>
        <div className="flex flex-wrap items-center gap-2.5"><h1 className="text-xl font-semibold tracking-tight lg:text-2xl">{project.name}</h1><span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClasses(project.status)}`}>{statusLabel(project.status)}</span>{!project.permissions.canEditProject ? <span className="inline-flex items-center gap-1 rounded-full border border-info/20 bg-info-soft px-2 py-0.5 text-xs font-medium text-info"><Eye className="size-3" />只读</span> : null}</div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>项目经理：{project.managerDisplayName ?? "待分配"}</span><span>更新：{dateLabel(project.updatedAt)}</span><span className="flex items-center gap-1.5"><Users className="size-3.5" />{project.memberCount} 位成员</span></div>
      </div>
      <nav className="flex gap-1 overflow-x-auto" aria-label="项目详情导航">{tabs.map((tab) => <Link key={tab.id} href={tab.id === "overview" ? `/projects/${project.id}` : `/projects/${project.id}/${tab.path}`} className={`relative whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors ${activeTab === tab.id ? "text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary" : "text-muted-foreground hover:text-foreground"}`}>{tab.label}</Link>)}</nav>
    </div>
  </div>;
}
