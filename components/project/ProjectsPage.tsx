"use client";

import Link from "next/link";
import { FolderKanban, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { dateLabel, statusClasses, statusLabel } from "./mock-view";

type Summary = {
  projectId: string;
  departmentName: string | null;
  fileCount: number;
  requirementCount: number;
  currentRequirementVersion: number | null;
  latestActivityAt: string;
};

export function ProjectsPage({ viewer }: { viewer: ViewerContext }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [summaries, setSummaries] = useState<Map<string, Summary>>(new Map());
  useEffect(() => {
    const controller = new AbortController();
    void fetch(withBasePath("/api/projects/focused-summaries"), {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok
          ? (response.json() as Promise<{ summaries: Summary[] }>)
          : { summaries: [] },
      )
      .then((payload) =>
        setSummaries(
          new Map(payload.summaries.map((item) => [item.projectId, item])),
        ),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return viewer.projects.filter((project) => {
      const summary = summaries.get(project.id);
      return (
        (!keyword ||
          `${project.name} ${summary?.departmentName ?? ""}`
            .toLocaleLowerCase("zh-CN")
            .includes(keyword)) &&
        (status === "all" || project.status === status)
      );
    });
  }, [query, status, summaries, viewer.projects]);
  return (
    <main className="min-h-full px-5 py-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">内部项目空间</p>
          <h1 className="text-2xl font-semibold tracking-tight">项目</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            创建项目、集中资料并维护一份可审核的需求文档。
          </p>
        </div>
        {viewer.canCreateProject ? (
          <Link
            href="/projects/new"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" />
            创建项目
          </Link>
        ) : null}
      </header>
      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap gap-2 border-b p-4">
          <label className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目或项目经理"
              className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-9 rounded-lg border bg-background px-3 text-sm"
          >
            <option value="all">全部状态</option>
            <option value="planning">规划中</option>
            <option value="active">进行中</option>
            <option value="completed">已完成</option>
            <option value="archived">已归档</option>
          </select>
        </div>
        {filtered.length ? (
          <div className="divide-y">
            {filtered.map((project) => {
              const summary = summaries.get(project.id);
              return (
                <Link
                  key={project.id}
                href={`/projects/${project.id}`}
                  className="grid gap-3 px-4 py-4 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr_100px_90px_130px] md:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {project.name}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {project.description || "暂无项目描述"}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {summary?.departmentName ?? "未分配部门"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {project.managerDisplayName ?? "待分配"}
                  </span>
                  <span
                    className={`w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(project.status)}`}
                  >
                    {statusLabel(project.status)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    资料 {summary?.fileCount ?? "—"} · 需求{" "}
                    {summary?.requirementCount ?? "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {dateLabel(summary?.latestActivityAt ?? project.updatedAt)}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center px-6 text-center">
            <div>
              <FolderKanban className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">没有匹配的项目</p>
              <p className="mt-1 text-xs text-muted-foreground">
                调整关键词或创建第一个项目。
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
