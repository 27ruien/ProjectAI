"use client";

import {
  FileText,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { dateLabel, statusLabel } from "./mock-view";

export function ProjectOverviewPage({
  project,
}: {
  project: AuthorizedProjectSummary;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<{
    departmentName: string | null;
    fileCount: number;
    requirementCount: number;
    currentRequirementVersion: number | null;
    latestActivityAt: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState(project.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch(withBasePath("/api/projects/focused-summaries"), {
      credentials: "include",
      cache: "no-store",
    })
      .then(
        async (response) =>
          response.json() as Promise<{
            summaries: Array<{
              projectId: string;
              departmentName: string | null;
          fileCount: number;
          requirementCount: number;
          currentRequirementVersion: number | null;
              latestActivityAt: string;
            }>;
          }>,
      )
      .then((payload) =>
        setSummary(
          payload.summaries.find((item) => item.projectId === project.id) ??
            null,
        ),
      )
      .catch(() => undefined);
  }, [project.id]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        withBasePath(`/api/projects/${project.id}`),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, description, status }),
        },
      );
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "保存失败");
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };
  const closeProject = async () => {
    if (!window.confirm("确认关闭该项目？关闭后资料仍会保留。")) return;
    const response = await fetch(withBasePath(`/api/projects/${project.id}`), {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "关闭失败");
      return;
    }
    router.refresh();
  };
  const deleteProject = async () => {
    if (
      !window.confirm("只允许删除没有资料、需求和对话记录的空项目。确认继续？")
    )
      return;
    const response = await fetch(withBasePath(`/api/projects/${project.id}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "删除失败");
      return;
    }
    router.push("/projects");
    router.refresh();
  };
  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader project={project} activeTab="overview" />
      <div className="px-5 py-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryCard
            icon={FolderOpen}
            label="项目资料"
            value={summary?.fileCount ?? "—"}
          />
          <SummaryCard
            icon={FileText}
        label="当前需求文档版本"
        value={summary?.currentRequirementVersion ? `v${summary.currentRequirementVersion}` : "—"}
          />
          <SummaryCard
            icon={Users}
            label="项目成员"
            value={project.memberCount}
          />
        </div>
        <section className="mt-6 rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">项目基本信息</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                最近活动：
                {dateLabel(summary?.latestActivityAt ?? project.updatedAt)}
              </p>
            </div>
            {project.permissions.canEditProject ? (
              <button
                onClick={() => setEditing((value) => !value)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
              >
                <Pencil className="size-3.5" />
                {editing ? "取消" : "编辑"}
              </button>
            ) : null}
          </div>
          {editing ? (
            <form onSubmit={save} className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                项目名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  minLength={2}
                  maxLength={200}
                  className="mt-2 h-10 w-full rounded-lg border bg-background px-3"
                />
              </label>
              <label className="block text-sm font-medium">
                项目描述
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  maxLength={4000}
                  className="mt-2 w-full rounded-lg border bg-background px-3 py-2"
                />
              </label>
              <label className="block text-sm font-medium">
                状态
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border bg-background px-3"
                >
                  <option value="planning">规划中</option>
                  <option value="active">进行中</option>
                  <option value="completed">已完成</option>
                  <option value="archived">已归档</option>
                </select>
              </label>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <button
                disabled={saving}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {saving ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                保存
              </button>
            </form>
          ) : (
            <dl className="mt-5 grid gap-5 sm:grid-cols-2">
              <Info label="名称" value={project.name} />
              <Info
                label="项目经理"
                value={project.managerDisplayName ?? "待分配"}
              />
              <Info
                label="所属部门"
                value={summary?.departmentName ?? "未分配部门"}
              />
              <Info label="状态" value={statusLabel(project.status)} />
              <Info label="创建时间" value={dateLabel(project.createdAt)} />
              <Info label="更新时间" value={dateLabel(project.updatedAt)} />
              <div className="sm:col-span-2">
                <Info label="描述" value={project.description || "暂无描述"} />
              </div>
            </dl>
          )}
        </section>
        {project.permissions.canDeleteProject ? (
          <section className="mt-6 rounded-xl border border-warning/25 bg-card p-5">
            <h2 className="text-sm font-semibold">项目生命周期</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              关闭会保留资料和历史；只有完全空的项目才能删除。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void closeProject()}
                className="h-9 rounded-lg border px-3 text-sm font-medium hover:bg-muted"
              >
                关闭项目
              </button>
              <button
                onClick={() => void deleteProject()}
                className="h-9 rounded-lg border border-destructive/30 px-3 text-sm font-medium text-destructive hover:bg-destructive-soft"
              >
                删除空项目
              </button>
            </div>
            {error ? (
              <p className="mt-3 text-sm text-destructive">{error}</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderOpen;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <Icon className="size-5 text-primary" />
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
