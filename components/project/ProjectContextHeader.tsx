"use client";

import Link from "next/link";
import { Bot, ChevronRight, Plus, Sparkles, Users } from "lucide-react";
import { projects } from "@/data/mock";
import {
  asRecords,
  dateLabel,
  initials,
  statusClasses,
  statusLabel,
  stringList,
  textValue,
} from "./mock-view";

export type ProjectTab =
  | "overview"
  | "documents"
  | "knowledge"
  | "requirements"
  | "scope"
  | "actions"
  | "meetings"
  | "risks";

const tabs: { id: ProjectTab; label: string; path: string }[] = [
  { id: "overview", label: "项目概览", path: "overview" },
  { id: "documents", label: "项目资料", path: "documents" },
  { id: "knowledge", label: "项目知识", path: "knowledge" },
  { id: "requirements", label: "需求中心", path: "requirements" },
  { id: "scope", label: "Scope 管理", path: "scope" },
  { id: "actions", label: "Action Plan", path: "actions" },
  { id: "meetings", label: "会议与决策", path: "meetings" },
  { id: "risks", label: "风险与状态", path: "risks" },
];

interface ProjectContextHeaderProps {
  projectId?: string;
  activeTab: ProjectTab;
  onOpenAI?: () => void;
}

export function getProjectRecord(projectId?: string) {
  const records = asRecords(projects);
  return (
    records.find((project) => textValue(project, "id", "") === projectId) ??
    records[0]
  );
}

export function ProjectContextHeader({
  projectId,
  activeTab,
  onOpenAI,
}: ProjectContextHeaderProps) {
  const project = getProjectRecord(projectId);
  const id = textValue(project, "id", projectId ?? "p1");
  const name = textValue(project, ["name", "projectName"], "北美旗舰店 AI 互动活动");
  const manager = textValue(project, ["manager", "projectManager", "owner"], "林可");
  const members = stringList(project, ["members", "projectMembers"]);
  const status = textValue(project, "status", "active");
  const health = textValue(project, ["health", "healthStatus"], "attention");

  return (
    <div className="border-b border-border bg-card">
      <div className="px-5 pb-0 pt-5 lg:px-8">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Link href="/projects" className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                项目
              </Link>
              <ChevronRight className="size-3.5" />
              <span className="truncate">{textValue(project, ["client", "clientName"], "客户项目")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground lg:text-2xl">{name}</h1>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClasses(status)}`}>
                {statusLabel(status)}
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClasses(health)}`}>
                健康度 · {statusLabel(health)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span>阶段：{textValue(project, ["stage", "currentStage"], "交付实施")}</span>
              <span>项目经理：{manager}</span>
              <span>上线：{dateLabel(project?.targetLaunchDate ?? project?.launchDate)}</span>
              <span>更新：{dateLabel(project?.updatedAt)}</span>
              <span className="flex items-center gap-1.5">
                <Users className="size-3.5" />
                {members.length || 6} 位成员
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden -space-x-2 md:flex" aria-label="项目成员">
              {(members.length ? members : [manager, "周霖", "陈舟"]).slice(0, 4).map((member, index) => (
                <span
                  key={`${member}-${index}`}
                  title={member}
                  className="grid size-8 place-items-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-muted-foreground"
                >
                  {initials(member)}
                </span>
              ))}
            </div>
            {onOpenAI ? (
              <button
                type="button"
                onClick={onOpenAI}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Bot className="size-4 text-primary" />
                AI 助手
              </button>
            ) : (
              <Link
                href={`/projects/${id}/knowledge`}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Bot className="size-4 text-primary" />
                AI 助手
              </Link>
            )}
            <Link
              href={`/workflows/requirement-extraction?project=${id}`}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              <Sparkles className="size-4" />
              <span className="hidden sm:inline">创建 AI 工作流</span>
              <Plus className="size-4 sm:hidden" />
            </Link>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto" aria-label="项目详情导航">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={`/projects/${id}/${tab.path}`}
              className={`relative whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                activeTab === tab.id
                  ? "text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
