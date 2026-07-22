"use client";
import { useEffect, useState } from "react";
import { History, LoaderCircle } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { projectManagementRequest } from "@/lib/project-management/client";
type Audit = {
  id: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  actorUserId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
export function ProjectAuditPage({
  project,
}: {
  project: AuthorizedProjectSummary;
}) {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void projectManagementRequest<{ audits: Audit[] }>(
      `/api/projects/${encodeURIComponent(project.id)}/management-audits`,
      { signal: controller.signal },
    )
      .then((result) => setAudits(result.audits))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "审计加载失败"),
      )
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [project.id]);
  if (loading)
    return (
      <div className="grid min-h-72 place-items-center">
        <LoaderCircle className="size-6 animate-spin text-primary" />
      </div>
    );
  return (
    <div className="space-y-5">
      <header>
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <History className="size-3.5" /> Project-bound Audit
        </p>
        <h1 className="mt-1 text-2xl font-semibold">项目管理审计</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          仅项目经理可查看；记录资源 ID、受控计数和状态，不保存 Secret
          或来源正文。
        </p>
      </header>
      {error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive-soft p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 text-[10px] text-muted-foreground">
              <tr>
                <th className="p-3">时间</th>
                <th className="p-3">事件</th>
                <th className="p-3">资源</th>
                <th className="p-3">Actor</th>
                <th className="p-3">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {audits.map((audit) => (
                <tr key={audit.id}>
                  <td className="p-3 whitespace-nowrap">
                    {new Date(audit.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="p-3 font-medium">{audit.eventType}</td>
                  <td className="p-3 font-mono text-[10px]">
                    {audit.resourceType} · {audit.resourceId}
                  </td>
                  <td className="p-3 font-mono text-[10px]">
                    {audit.actorUserId}
                  </td>
                  <td className="p-3 text-[10px] text-muted-foreground">
                    {Object.entries(audit.metadata)
                      .map(
                        ([key, value]) =>
                          `${key}=${typeof value === "object" ? "[structured]" : String(value)}`,
                      )
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!audits.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            暂无项目管理审计记录。
          </p>
        ) : null}
      </section>
    </div>
  );
}
