"use client";

import Link from "next/link";
import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { statusClasses, statusLabel } from "./mock-view";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

export type ProjectTab = "overview" | "files" | "requirements" | "members";
const tabs: { id: ProjectTab; label: string; path: string }[] = [
  { id: "overview", label: "概览", path: "overview" }, { id: "files", label: "项目资料", path: "files" }, { id: "requirements", label: "需求文档", path: "requirements" }, { id: "members", label: "成员与权限", path: "members" },
];

export function ProjectContextHeader({ project, activeTab, actions }: { project: AuthorizedProjectSummary; activeTab: ProjectTab; actions?: ReactNode }) {
  return <div className="border-b bg-card">
    <div className="px-5 pt-5 sm:px-6 lg:px-8">
      <Breadcrumb className="mb-3"><BreadcrumbList className="text-xs"><BreadcrumbItem><BreadcrumbLink asChild><Link href="/projects">项目</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{project.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2.5"><h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1><Badge variant="outline" className={statusClasses(project.status)}>{statusLabel(project.status)}</Badge>{!project.permissions.canEditProject ? <Badge variant="outline" className="border-info/20 bg-info-soft text-info"><Eye />只读</Badge> : null}</div><p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">{project.description || "暂无项目描述"}</p></div>{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}</div>
      <nav className="mt-5 flex gap-1 overflow-x-auto" aria-label="项目详情导航">{tabs.map((tab) => <Link key={tab.id} href={tab.id === "overview" ? `/projects/${project.id}` : `/projects/${project.id}/${tab.path}`} className={`relative whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors ${activeTab === tab.id ? "text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground"}`}>{tab.label}</Link>)}</nav>
    </div>
  </div>;
}
