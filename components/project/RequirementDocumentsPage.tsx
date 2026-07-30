"use client";

import {
  Download,
  FileText,
  History,
  LoaderCircle,
  RefreshCw,
  Save,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { ProjectContextHeader } from "./ProjectContextHeader";

type Section = {
  key: string;
  title: string;
  content: string;
  citationLabels: string[];
};
type Citation = {
  label: string;
  valid: boolean;
  sourceScope?: string;
  displayName?: string;
  sourceLocator?: Record<string, unknown>;
  excerpt?: string;
  reason?: string;
};
type RequirementDocument = {
  id: string;
  versionNumber: number;
  status: "generating" | "draft" | "published" | "failed";
  sections: Section[];
  citations: Citation[];
  failureCode: string | null;
  projectSourceCount: number;
  companySourceCount: number;
  sourceSnapshotAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

const failureMessages: Record<string, string> = {
  NO_ELIGIBLE_PROJECT_SOURCES:
    "当前项目没有可用于 AI 的资料，请先上传并等待解析完成。",
  NO_PUBLISHED_PROJECT_STANDARD:
    "当前没有已发布的公司项目管理规范。",
  REQUIREMENT_SKILL_NOT_CONFIGURED:
    "需求文档生成能力尚未配置。",
  REQUIREMENT_MODEL_PROFILE_NOT_CONFIGURED:
    "需求文档使用的 AI Model Profile 尚未正确配置。",
  REQUIREMENT_EXECUTION_CREATE_FAILED:
    "需求文档生成任务登记失败，请稍后重试。",
  REQUIREMENT_PROVIDER_FAILED:
    "AI 服务暂时无法生成需求文档，请稍后重试。",
  REQUIREMENT_OUTPUT_INVALID:
    "AI 返回的需求文档格式无效，请重新生成。",
  REQUIREMENT_CITATION_VALIDATION_FAILED:
    "AI 返回的来源引用无效，请重新生成。",
  REQUIREMENT_SOURCE_CHANGED:
    "资料在生成期间发生变化，请重新生成。",
};

export function RequirementDocumentsPage({
  project,
}: {
  project: AuthorizedProjectSummary;
}) {
  const [documents, setDocuments] = useState<RequirementDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [busy, setBusy] = useState<
    "generate" | "save" | "publish" | "restore" | null
  >(null);
  const [generationStep, setGenerationStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const steps = [
    "读取项目最新资料",
    "读取已发布公司标准",
    "生成 17 个需求章节",
    "校验来源并保存版本",
  ];
  const load = useCallback(
    async (preferredId?: string) => {
      const response = await fetch(
        withBasePath(`/api/projects/${project.id}/requirement-documents`),
        { credentials: "include", cache: "no-store" },
      );
      const body = (await response.json()) as {
        documents?: RequirementDocument[];
        canEdit?: boolean;
        canPublish?: boolean;
        error?: { message?: string };
      };
      if (!response.ok)
        throw new Error(body.error?.message ?? "需求文档加载失败");
      const rows = body.documents ?? [];
      setDocuments(rows);
      setCanEdit(Boolean(body.canEdit));
      setCanPublish(Boolean(body.canPublish));
      const next =
        rows.find((item) => item.id === preferredId) ?? rows[0] ?? null;
      setSelectedId(next?.id ?? null);
      setSections(next?.sections ?? []);
      return rows;
    },
    [project.id],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) =>
        setError(caught instanceof Error ? caught.message : "需求文档加载失败"),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (busy !== "generate") return;
    const timer = window.setInterval(
      () => setGenerationStep((value) => Math.min(value + 1, steps.length - 1)),
      1800,
    );
    return () => window.clearInterval(timer);
  }, [busy, steps.length]);
  const selected = useMemo(
    () => documents.find((item) => item.id === selectedId) ?? null,
    [documents, selectedId],
  );
  useEffect(() => {
    if (!documents.some((item) => item.status === "generating")) return;
    const timer = window.setInterval(() => {
      void load(selectedId ?? undefined).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [documents, load, selectedId]);
  const request = async (path: string, init: RequestInit) => {
    const response = await fetch(withBasePath(path), {
      credentials: "include",
      ...init,
    });
    const body = (await response.json()) as {
      document?: { id?: string };
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(body.error?.message ?? "操作失败");
    return body.document?.id;
  };
  const generate = async () => {
    setBusy("generate");
    setGenerationStep(0);
    setError(null);
    try {
      const id = await request(
        `/api/projects/${project.id}/requirement-documents`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      await load(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败");
      await load();
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!selected) return;
    setBusy("save");
    setError(null);
    try {
      await request(
        `/api/projects/${project.id}/requirement-documents/${selected.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sections }),
        },
      );
      await load(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };
  const publish = async () => {
    if (!selected) return;
    setBusy("publish");
    setError(null);
    try {
      await request(
        `/api/projects/${project.id}/requirement-documents/${selected.id}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      await load(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发布失败");
    } finally {
      setBusy(null);
    }
  };
  const restore = async (document: RequirementDocument) => {
    setBusy("restore");
    setError(null);
    try {
      const id = await request(
        `/api/projects/${project.id}/requirement-documents/${document.id}/restore`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      await load(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复失败");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="min-h-full">
      <ProjectContextHeader project={project} activeTab="requirements" />
      <div className="px-5 py-6 lg:px-8">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">需求文档</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              基于项目最新资料与已发布公司项目管理标准生成，AI
              结果必须人工审核。
            </p>
          </div>
          {canEdit ? (
            <button
              onClick={() => void generate()}
              disabled={Boolean(busy)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy === "generate" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              生成新版本
            </button>
          ) : null}
        </header>
        {busy === "generate" || selected?.status === "generating" ? (
          <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <p className="text-sm font-medium">{steps[generationStep]}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: `${((generationStep + 1) / steps.length) * 100}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              可以离开本页；返回后会继续显示已登记任务的状态与结果。
            </p>
          </div>
        ) : null}
        {error ? (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive-soft p-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
          <section className="rounded-xl border bg-card">
            {!selected ? (
              <div className="grid min-h-96 place-items-center text-center">
                <div>
                  <FileText className="mx-auto size-9 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">尚无需求文档</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    上传并解析项目资料后生成第一版。
                  </p>
                </div>
              </div>
            ) : selected.status === "failed" ? (
              <div className="grid min-h-96 place-items-center text-center">
                <div>
                  <RefreshCw className="mx-auto size-8 text-destructive" />
                  <p className="mt-3 text-sm font-medium">生成失败</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {failureMessages[selected.failureCode ?? ""] ??
                      "需求文档生成失败，请稍后重试。"}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    失败码：{selected.failureCode ?? "UNKNOWN"}
                  </p>
                  {canEdit ? (
                    <button
                      onClick={() => void generate()}
                      disabled={Boolean(busy)}
                      className="mt-4 h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"
                    >
                      重试生成新版本
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                  <div>
                    <p className="text-sm font-semibold">
                      版本 v{selected.versionNumber}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected.status === "published"
                        ? "已发布"
                        : selected.status === "generating"
                          ? "生成中"
                          : "草稿"}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      项目资料 {selected.projectSourceCount} 份 · 公司规范{" "}
                      {selected.companySourceCount} 份 · 快照{" "}
                      {new Date(selected.sourceSnapshotAt).toLocaleString(
                        "zh-CN",
                      )}
                    </p>
                    {selected.companySourceCount === 0 ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        本次未使用公司规范，仅基于项目资料生成。
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selected.status !== "generating" ? (
                      <>
                        <a
                          href={withBasePath(
                            `/api/projects/${project.id}/requirement-documents/${selected.id}/export?format=md`,
                          )}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                        >
                          <Download className="size-3.5" />
                          Markdown
                        </a>
                        <a
                          href={withBasePath(
                            `/api/projects/${project.id}/requirement-documents/${selected.id}/export?format=docx`,
                          )}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                        >
                          <Download className="size-3.5" />
                          DOCX
                        </a>
                      </>
                    ) : null}
                    {canEdit && selected.status !== "generating" ? (
                      <button
                        onClick={() => void save()}
                        disabled={Boolean(busy)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                      >
                        <Save className="size-3.5" />
                        保存草稿
                      </button>
                    ) : null}
                    {canPublish && selected.status === "draft" ? (
                      <button
                        onClick={() => void publish()}
                        disabled={Boolean(busy)}
                        className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"
                      >
                        发布
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-5 p-5">
                  {sections.map((section, index) => (
                    <article key={section.key}>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">
                          {index + 1}. {section.title}
                        </h3>
                        {section.citationLabels.map((label) => (
                          <span
                            key={label}
                            className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                          >
                            [{label}]
                          </span>
                        ))}
                      </div>
                      {canEdit && selected.status !== "generating" ? (
                        <textarea
                          rows={Math.max(
                            3,
                            Math.min(
                              10,
                              section.content.split("\n").length + 1,
                            ),
                          )}
                          value={section.content}
                          onChange={(event) =>
                            setSections((current) =>
                              current.map((item) =>
                                item.key === section.key
                                  ? { ...item, content: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          className="w-full rounded-lg border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-primary"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                          {section.content}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
          <aside className="space-y-5">
            <section className="rounded-xl border bg-card p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History className="size-4" />
                版本历史
              </h3>
              <div className="mt-3 space-y-2">
                {documents.map((document) => (
                  <div
                    key={document.id}
                    className={`rounded-lg border p-3 ${document.id === selectedId ? "border-primary/35 bg-primary/5" : ""}`}
                  >
                    <button
                      onClick={() => {
                        setSelectedId(document.id);
                        setSections(document.sections);
                      }}
                      className="w-full text-left"
                    >
                      <p className="text-xs font-medium">
                        v{document.versionNumber} ·{" "}
                        {
                          {
                            generating: "生成中",
                            draft: "草稿",
                            published: "已发布",
                            failed: "失败",
                          }[document.status]
                        }
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(document.updatedAt).toLocaleString("zh-CN")}
                      </p>
                    </button>
                    {canEdit &&
                    document.id !== selectedId &&
                    ["draft", "published"].includes(document.status) ? (
                      <button
                        onClick={() => void restore(document)}
                        disabled={Boolean(busy)}
                        className="mt-2 text-[11px] font-medium text-primary hover:underline"
                      >
                        恢复为新草稿
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
            {selected?.citations.length ? (
              <section className="rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold">来源引用</h3>
                <div className="mt-3 space-y-2">
                  {selected.citations.map((citation) => (
                    <div
                      key={citation.label}
                      className={`rounded-lg border p-3 ${citation.valid ? "" : "border-warning/30 bg-warning-soft"}`}
                    >
                      <p className="text-xs font-semibold">
                        [{citation.label}]{" "}
                        {citation.valid
                          ? citation.displayName
                          : "来源已失效或更新"}
                      </p>
                      {citation.valid ? (
                        <>
                          <p className="mt-1 text-[10px] font-medium text-primary">
                            {citation.sourceScope === "organization"
                              ? "公司资料"
                              : "项目资料"}
                          </p>
                          <p className="mt-2 line-clamp-4 text-[11px] leading-5 text-muted-foreground">
                            {citation.excerpt}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1 text-[11px] text-warning">
                          该引用不再作为当前有效证据，请重新生成或复核。
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
