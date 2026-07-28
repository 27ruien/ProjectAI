"use client";

import Link from "next/link";
import { FolderKanban, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { ViewerContext } from "@/lib/auth/ui-types";

export function GlobalSearchPage({ viewer }: { viewer: ViewerContext }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  const projects = useMemo(
    () =>
      normalized
        ? viewer.projects.filter((project) =>
            [project.name, project.clientName, project.description]
              .join(" ")
              .toLocaleLowerCase("zh-CN")
              .includes(normalized),
          )
        : viewer.projects,
    [normalized, viewer.projects],
  );

  return (
    <div className="space-y-6" data-testid="global-search-page">
      <header>
        <p className="text-xs font-medium text-primary">Authorized Search</p>
        <h1 className="mt-1 text-2xl font-semibold">全局搜索</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          只搜索服务端已授权且未标记为测试 Fixture 的项目。
        </p>
      </header>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
        <span className="sr-only">搜索已授权项目</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-10 w-full rounded-lg border border-input bg-card pl-10 pr-3 text-sm"
          placeholder="搜索项目、客户或说明"
          autoFocus
        />
      </label>
      <section className="divide-y divide-border rounded-xl border border-border bg-card">
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
          >
            <FolderKanban className="size-4 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{project.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {project.clientName} · {project.status}
              </span>
            </span>
          </Link>
        ))}
        {projects.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            没有匹配的已授权项目。
          </p>
        ) : null}
      </section>
    </div>
  );
}
