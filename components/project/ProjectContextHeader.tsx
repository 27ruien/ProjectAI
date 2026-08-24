"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusLabel } from "./mock-view";

export type ProjectTab = "knowledge" | "members";

const tabs: { id: ProjectTab; label: string; path: string }[] = [
  { id: "knowledge", label: "知识库", path: "knowledge" },
  { id: "members", label: "成员与权限", path: "members" },
];

const statusTone: Record<string, string> = {
  planning: "border-border bg-muted text-muted-foreground",
  active: "border-success/20 bg-success-soft text-success",
  completed: "border-border bg-muted text-muted-foreground",
};

export function ProjectContextHeader({
  project,
  activeTab,
  actions,
}: {
  project: AuthorizedProjectSummary;
  activeTab: ProjectTab;
  actions?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${project.name} · Project AI`;
  }, [project.name]);

  return (
    <header className="border-b bg-background">
      <div className="mx-auto max-w-[1280px] px-4 pt-5 sm:px-6 lg:px-10">
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />项目
        </Link>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold leading-8 tracking-[-0.025em]">{project.name}</h1>
              <Badge variant="outline" className={statusTone[project.status] ?? statusTone.planning}>{statusLabel(project.status)}</Badge>
              {!project.permissions.canEditProject ? <Badge variant="outline" className="text-muted-foreground"><Eye className="size-3" />只读</Badge> : null}
            </div>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">{project.description || "暂无项目描述"}</p>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        <nav className="mt-5 flex gap-6" aria-label="项目页面">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={`/projects/${project.id}/${tab.path}`}
              aria-current={activeTab === tab.id ? "page" : undefined}
              data-testid={tab.id === "knowledge" ? "project-knowledge-tab" : undefined}
              className={cn(
                "relative pb-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                activeTab === tab.id && "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
