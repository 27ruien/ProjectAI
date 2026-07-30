"use client";

import {
  Download,
  FileUp,
  Library,
  LoaderCircle,
  Search,
  Upload,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import type {
  ProjectDocumentDto,
  ProjectDocumentVersionDto,
} from "@/types/documents";

type Category =
  | "charter"
  | "hr"
  | "project_management"
  | "security"
  | "finance"
  | "template"
  | "other";
type CompanyDocument = ProjectDocumentDto & {
  category: Category;
  lifecycleStatus: "draft" | "published" | "expired" | "archived";
  audience: "organization" | "department" | "admin";
  departmentId: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
};
type Department = { id: string; name: string };
const categoryLabels: Record<Category, string> = {
  charter: "公司章程",
  hr: "人事制度",
  project_management: "项目管理规范",
  security: "信息安全",
  finance: "财务与采购",
  template: "标准模板",
  other: "其他",
};

export function CompanyKnowledgePage() {
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | Category>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadVersionNote, setUploadVersionNote] = useState("");
  const [uploadCategory, setUploadCategory] =
    useState<Category>("project_management");
  const [audience, setAudience] = useState<
    "organization" | "department" | "admin"
  >("organization");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    document: CompanyDocument;
    versions: ProjectDocumentVersionDto[];
  } | null>(null);
  const [versionTarget, setVersionTarget] = useState<CompanyDocument | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNote, setVersionNote] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(withBasePath("/api/company-knowledge"), {
      credentials: "include",
      cache: "no-store",
    });
    const body = (await response.json()) as {
      documents?: CompanyDocument[];
      canManage?: boolean;
      error?: { message?: string };
    };
    if (!response.ok)
      throw new Error(body.error?.message ?? "公司知识库加载失败");
    setDocuments(body.documents ?? []);
    setCanManage(Boolean(body.canManage));
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "公司知识库加载失败",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!canManage) return;
    void fetch(withBasePath("/api/projects/creation-context"), {
      credentials: "include",
    })
      .then(
        async (response) =>
          response.json() as Promise<{ departments?: Department[] }>,
      )
      .then((body) => setDepartments(body.departments ?? []))
      .catch(() => undefined);
  }, [canManage]);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return documents.filter(
      (item) =>
        (category === "all" || item.category === category) &&
        (!keyword ||
          item.displayName.toLocaleLowerCase("zh-CN").includes(keyword)),
    );
  }, [category, documents, query]);
  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("displayName", file.name.replace(/\.[^.]+$/, ""));
      form.set("category", uploadCategory);
      form.set("audience", audience);
      if (uploadVersionNote.trim()) form.set("versionNote", uploadVersionNote.trim());
      if (audience === "department") form.set("departmentId", departmentId);
      const response = await fetch(withBasePath("/api/company-knowledge"), {
        method: "POST",
        credentials: "include",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: form,
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "上传失败");
      setUploadOpen(false);
      setFile(null);
      setUploadVersionNote("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };
  const changeLifecycle = async (
    document: CompanyDocument,
    lifecycleStatus: CompanyDocument["lifecycleStatus"],
  ) => {
    setError(null);
    const response = await fetch(
      withBasePath(`/api/company-knowledge/${document.id}`),
      {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lifecycleStatus }),
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "状态更新失败");
      return;
    }
    await response.json();
    await load();
  };
  const newVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!versionTarget || !versionFile) return;
    const form = new FormData();
    form.set("file", versionFile);
    if (versionNote.trim()) form.set("versionNote", versionNote.trim());
    setBusy(true);
    const response = await fetch(
      withBasePath(`/api/company-knowledge/${versionTarget.id}/versions`),
      {
        method: "POST",
        credentials: "include",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: form,
      },
    );
    if (!response.ok) {
      const body = (await response.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "新版本上传失败");
    } else {
      setVersionTarget(null);
      setVersionFile(null);
      setVersionNote("");
      await load();
    }
    setBusy(false);
  };
  const openHistory = async (document: CompanyDocument) => {
    const response = await fetch(
      withBasePath(`/api/company-knowledge/${document.id}/versions`),
      { credentials: "include", cache: "no-store" },
    );
    const body = (await response.json()) as {
      versions?: ProjectDocumentVersionDto[];
      error?: { message?: string };
    };
    if (!response.ok) {
      setError(body.error?.message ?? "版本历史加载失败");
      return;
    }
    setHistory({ document, versions: body.versions ?? [] });
  };
  return (
    <main className="min-h-full px-5 py-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">公司级有效知识</p>
          <h1 className="text-2xl font-semibold tracking-tight">公司知识库</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            只有已发布且未失效的资料可以进入普通成员的 AI 检索。
          </p>
        </div>
        {canManage ? (
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground"
          >
            <Upload className="size-4" />
            上传公司资料
          </button>
        ) : null}
      </header>
      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive-soft p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <section className="rounded-xl border bg-card">
        <div className="flex flex-wrap gap-2 border-b p-4">
          <label className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索公司资料"
              className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
            />
          </label>
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as typeof category)
            }
            className="h-9 rounded-lg border bg-background px-3 text-sm"
          >
            <option value="all">全部类别</option>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {filtered.length ? (
          <div className="divide-y">
            {filtered.map((document) => (
              <article
                key={document.id}
                className="flex flex-wrap items-center gap-4 px-4 py-4"
              >
                <span className="grid size-10 place-items-center rounded-lg bg-primary/8 text-primary">
                  <Library className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {document.displayName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {categoryLabels[document.category]} · v
                    {document.currentVersion?.versionNumber ?? "—"} ·{" "}
                    {document.audience === "organization"
                      ? "全公司"
                      : document.audience === "department"
                        ? "指定部门"
                        : "仅管理员"}{" "}
                    ·{" "}
                    {
                      {
                        draft: "草稿",
                        published: "已发布",
                        expired: "已失效",
                        archived: "已归档",
                      }[document.lifecycleStatus]
                    }
                  </p>
                </div>
                {document.currentVersion ? (
                  <>
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={withBasePath(
                        `/api/company-knowledge/${document.id}/versions/${document.currentVersion.id}/download?preview=true`,
                      )}
                      className="inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                    >
                      预览
                    </a>
                    <a
                      href={withBasePath(
                        `/api/company-knowledge/${document.id}/versions/${document.currentVersion.id}/download`,
                      )}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                    >
                      <Download className="size-3.5" />
                      下载
                    </a>
                  </>
                ) : null}
                <button
                  onClick={() => void openHistory(document)}
                  className="h-8 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                >
                  版本历史
                </button>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setVersionTarget(document)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                    >
                      <FileUp className="size-3.5" />
                      新版本
                    </button>
                    {document.lifecycleStatus !== "published" ? (
                      <button
                        onClick={() =>
                          void changeLifecycle(document, "published")
                        }
                        className="h-8 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"
                      >
                        发布
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          void changeLifecycle(document, "expired")
                        }
                        className="h-8 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
                      >
                        设为失效
                      </button>
                    )}
                    <button
                      onClick={() => void changeLifecycle(document, "archived")}
                      className="h-8 rounded-lg border px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
                    >
                      归档
                    </button>
                  </>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center text-center">
            <div>
              <Library className="mx-auto size-9 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">暂无可见公司资料</p>
              <p className="mt-1 text-xs text-muted-foreground">
                管理员上传并发布后，资料才会对相应成员可见。
              </p>
            </div>
          </div>
        )}
      </section>
      {uploadOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay)] p-4">
          <form
            onSubmit={upload}
            className="w-full max-w-lg rounded-xl border bg-card p-5 shadow-xl"
          >
            <h2 className="text-lg font-semibold">上传公司资料</h2>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                文件
                <input
                  required
                  type="file"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="mt-2 block w-full text-sm"
                />
              </label>
              <label className="block text-sm font-medium">
                类别
                <select
                  value={uploadCategory}
                  onChange={(event) =>
                    setUploadCategory(event.target.value as Category)
                  }
                  className="mt-2 h-10 w-full rounded-lg border bg-background px-3"
                >
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                可见范围
                <select
                  value={audience}
                  onChange={(event) =>
                    setAudience(event.target.value as typeof audience)
                  }
                  className="mt-2 h-10 w-full rounded-lg border bg-background px-3"
                >
                  <option value="organization">全公司</option>
                  <option value="department">指定部门</option>
                  <option value="admin">仅管理员</option>
                </select>
              </label>
              {audience === "department" ? (
                <label className="block text-sm font-medium">
                  部门
                  <select
                    required
                    value={departmentId}
                    onChange={(event) => setDepartmentId(event.target.value)}
                    className="mt-2 h-10 w-full rounded-lg border bg-background px-3"
                  >
                    <option value="">请选择</option>
                    {departments.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-sm font-medium">
                版本说明（可选）
                <textarea
                  value={uploadVersionNote}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => setUploadVersionNote(event.target.value)}
                  className="mt-2 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </label>
              <p className="rounded-lg bg-warning-soft p-3 text-xs text-warning">
                新上传和新版本默认是草稿，不会进入普通成员的 AI
                检索；请人工检查后再发布。
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="h-9 rounded-lg border px-3 text-sm"
              >
                取消
              </button>
              <button
                disabled={busy || !file}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                上传草稿
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {versionTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay)] p-4">
          <form
            onSubmit={newVersion}
            className="w-full max-w-lg rounded-xl border bg-card p-5 shadow-xl"
          >
            <h2 className="text-lg font-semibold">上传新版本</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {versionTarget.displayName}
            </p>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                文件
                <input
                  required
                  type="file"
                  onChange={(event) =>
                    setVersionFile(event.target.files?.[0] ?? null)
                  }
                  className="mt-2 block w-full text-sm"
                />
              </label>
              <label className="block text-sm font-medium">
                版本说明（可选）
                <textarea
                  value={versionNote}
                  maxLength={500}
                  rows={3}
                  onChange={(event) => setVersionNote(event.target.value)}
                  className="mt-2 w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </label>
              <p className="rounded-lg bg-warning-soft p-3 text-xs text-warning">
                新版本默认回到草稿，人工检查并发布后才进入 AI 检索。
              </p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setVersionTarget(null);
                  setVersionFile(null);
                  setVersionNote("");
                }}
                className="h-9 rounded-lg border px-3 text-sm"
              >
                取消
              </button>
              <button
                disabled={busy || !versionFile}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                上传新版本
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {history ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--overlay)] p-4">
          <section className="w-full max-w-lg rounded-xl border bg-card p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">版本历史</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {history.document.displayName}
                </p>
              </div>
              <button
                onClick={() => setHistory(null)}
                className="h-8 rounded-lg border px-3 text-xs"
              >
                关闭
              </button>
            </div>
            <div className="mt-4 divide-y rounded-lg border">
              {history.versions.map((version) => (
                <div key={version.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      v{version.versionNumber}
                      {version.isCurrent ? " · 当前" : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(version.createdAt).toLocaleString("zh-CN")}
                    </p>
                    {version.versionNote ? (
                      <p className="mt-1 text-xs text-foreground">
                        {version.versionNote}
                      </p>
                    ) : null}
                  </div>
                  <a
                    href={withBasePath(
                      `/api/company-knowledge/${history.document.id}/versions/${version.id}/download`,
                    )}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    下载
                  </a>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
