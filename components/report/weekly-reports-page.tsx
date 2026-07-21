"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, LoaderCircle, Send, Sparkles } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { withBasePath } from "@/lib/base-path";
import {
  projectManagementMutation,
  projectManagementRequest,
} from "@/lib/project-management/client";

type Sections = {
  completed: string[];
  inProgress: string[];
  nextWeek: string[];
  milestones: string[];
  blockers: string[];
  risks: string[];
  scopeChanges: string[];
  requirementChanges: string[];
  overdueActions: string[];
  decisionsNeeded: string[];
};
type Draft = {
  id: string;
  periodStart: string;
  periodEnd: string;
  sections: Sections;
  status: string;
  createdAt: string;
};
type Version = {
  id: string;
  versionNumber: number;
  periodStart: string;
  periodEnd: string;
  sections: Sections;
  publishedAt: string;
};
const labels: Array<[keyof Sections, string]> = [
  ["completed", "本周完成"],
  ["inProgress", "进行中"],
  ["nextWeek", "下周计划"],
  ["milestones", "Milestones"],
  ["blockers", "Blockers"],
  ["risks", "Risks"],
  ["scopeChanges", "Scope Changes"],
  ["requirementChanges", "新增或变更需求"],
  ["overdueActions", "逾期 Action Items"],
  ["decisionsNeeded", "需要决策事项"],
];

export function WeeklyReportsPage({
  project,
}: {
  project: AuthorizedProjectSummary;
}) {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 6);
  const [periodStart, setPeriodStart] = useState(
    startDate.toISOString().slice(0, 10),
  );
  const [periodEnd, setPeriodEnd] = useState(end);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [edits, setEdits] = useState<Record<string, Sections>>({});
  const [phase, setPhase] = useState<"loading" | "ready" | "working" | "error">(
    "loading",
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const payload = await projectManagementRequest<{
        drafts: Draft[];
        versions: Version[];
      }>(`/api/projects/${encodeURIComponent(project.id)}/weekly-reports`);
      setDrafts(payload.drafts);
      setVersions(payload.versions);
      setPhase("ready");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "周报加载失败");
      setPhase("error");
    }
  }, [project.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setPhase("working");
    try {
      await operation();
      setFeedback(success);
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "操作失败");
      setPhase("ready");
    }
  };
  const generate = () =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/weekly-reports`,
          "POST",
          { periodStart, periodEnd },
        ),
      "周报 Draft 已生成，等待人工审核。 ",
    );
  const publish = (draft: Draft) =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/weekly-reports/drafts/${encodeURIComponent(draft.id)}/publish`,
          "POST",
          { sections: edits[draft.id] ?? draft.sections },
        ),
      "周报已发布为新的不可覆盖版本。 ",
    );
  const updateSection = (draft: Draft, key: keyof Sections, value: string) =>
    setEdits((current) => ({
      ...current,
      [draft.id]: {
        ...(current[draft.id] ?? draft.sections),
        [key]: value
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      },
    }));
  if (phase === "loading")
    return (
      <div className="grid min-h-72 place-items-center rounded-xl border border-border bg-card">
        <LoaderCircle className="size-6 animate-spin text-primary" />
      </div>
    );
  return (
    <div className="space-y-5">
      <header>
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <FileText className="size-3.5" /> Draft → Review → Published Version
        </p>
        <h1 className="mt-1 text-2xl font-semibold">项目周报</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          仅汇总当前项目正式 Requirement、Scope、Action 与
          Risk；发布版本不可静默覆盖。
        </p>
      </header>
      {feedback ? (
        <div
          role="status"
          className="rounded-lg border border-info/20 bg-info-soft px-4 py-3 text-sm text-info"
        >
          {feedback}
        </div>
      ) : null}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="mb-1 block text-[10px] text-muted-foreground">
              开始日期
            </span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="h-9 rounded-lg border border-input px-3 text-xs"
            />
          </label>
          <label>
            <span className="mb-1 block text-[10px] text-muted-foreground">
              结束日期
            </span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="h-9 rounded-lg border border-input px-3 text-xs"
            />
          </label>
          <button
            disabled={
              phase === "working" || !project.permissions.canManageMembers
            }
            onClick={() => void generate()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            <Sparkles className="size-3.5" />
            生成周报 Draft
          </button>
        </div>
      </section>
      <section className="space-y-4">
        {drafts
          .filter((draft) => draft.status === "pending_review")
          .map((draft) => {
            const sections = edits[draft.id] ?? draft.sections;
            return (
              <article
                key={draft.id}
                className="rounded-xl border border-warning/30 bg-card"
              >
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <h2 className="text-sm font-semibold">
                      待审核周报 · {draft.periodStart} — {draft.periodEnd}
                    </h2>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      可编辑后发布；来源清单保存在服务端审计记录中。
                    </p>
                  </div>
                  <button
                    onClick={() => void publish(draft)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-xs font-medium text-white"
                  >
                    <Send className="size-3.5" />
                    审核并发布
                  </button>
                </div>
                <div className="grid gap-3 p-5 md:grid-cols-2">
                  {labels.map(([key, label]) => (
                    <label key={key}>
                      <span className="mb-1 block text-[11px] font-medium">
                        {label}
                      </span>
                      <textarea
                        rows={3}
                        value={sections[key].join("\n")}
                        onChange={(e) =>
                          updateSection(draft, key, e.target.value)
                        }
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs leading-5"
                        placeholder="每行一项"
                      />
                    </label>
                  ))}
                </div>
              </article>
            );
          })}
        {!drafts.some((draft) => draft.status === "pending_review") ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            暂无待审核周报 Draft。
          </div>
        ) : null}
      </section>
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Published Version History</h2>
        </div>
        <div className="divide-y divide-border">
          {versions.map((version) => (
            <article
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div>
                <p className="font-mono text-xs font-semibold text-primary">
                  v{version.versionNumber}
                </p>
                <p className="mt-1 text-sm">
                  {version.periodStart} — {version.periodEnd}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  发布于 {new Date(version.publishedAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <a
                href={withBasePath(
                  `/api/projects/${encodeURIComponent(project.id)}/weekly-reports/${encodeURIComponent(version.id)}/export`,
                )}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"
              >
                <Download className="size-3.5" />
                Markdown Export
              </a>
            </article>
          ))}
          {!versions.length ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              暂无已发布版本。
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
export default WeeklyReportsPage;
