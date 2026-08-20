"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  FileUp,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/project-primitives";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { withBasePath } from "@/lib/base-path";
import {
  listProjectDocuments,
  uploadProjectDocument,
} from "@/lib/documents/client";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import type { ProjectDocumentDto } from "@/types/documents";
import type { AssistantContextReference } from "@/types/project-assistant";

type ProductMapWorkflowPanelProps = {
  project: Pick<AuthorizedProjectSummary, "id"> &
    Partial<AuthorizedProjectSummary>;
  conversationId?: string | null;
  contextReferences?: AssistantContextReference[];
  open: boolean;
  onClose: () => void;
};

type SourceScope = "project" | "organization";
type Source = ProjectDocumentDto & { sourceScope?: SourceScope };
type Run = {
  id: string;
  projectId: string;
  status: string;
  currentStep: number;
  sourceCount: number;
  artifactCount?: number;
  failureCode: string | null;
  failureMessage?: string | null;
  createdAt?: string;
  limitedEvidence?: boolean;
  updatedAt: string;
};
type ArtifactVersion = {
  id?: string;
  version: number;
  content: Record<string, unknown>;
  markdown: string;
  mermaid: string;
  createdAt?: string;
  contentDigest?: string;
};
type Artifact = {
  id: string;
  projectId?: string;
  status: string;
  currentVersion: number;
  content: Record<string, unknown>;
  markdown: string;
  mermaid: string;
  contentDigest: string;
  publishedDocumentId?: string | null;
  publishedDocumentVersionId?: string | null;
};
type Detail = {
  run: Run;
  sources: Array<{
    id: string;
    documentId?: string;
    displayName: string;
    sourceType?: string;
    status: string;
  }>;
  artifacts: Artifact[];
  versions?: ArtifactVersion[];
  executions?: Array<{
    stepId?: string;
    status?: string;
    failureCode?: string | null;
  }>;
  permissions?: { canEdit: boolean; canReview: boolean; canPublish: boolean };
};
type Skill = {
  id: string;
  version: string;
  displayName: string;
  enabled?: boolean;
  status?: string;
  availabilityCode?: string | null;
};
type WorkflowList = { workflows?: Run[]; skills?: Skill[] };

const STEP_LABELS = [
  "材料盘点",
  "项目理解",
  "目标与用户行为",
  "用户路径",
  "产品功能结构",
  "页面与功能",
  "结构审查",
  "最终草稿",
];
const ACTIVE = new Set([
  "queued",
  "checking_sources",
  "uploading",
  "indexing",
  "retrieving",
  "running",
]);
const CANCELLABLE = new Set([...ACTIVE, "needs_input"]);
const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  checking_sources: "检查资料",
  uploading: "等待上传",
  indexing: "等待解析",
  retrieving: "检索证据",
  running: "生成中",
  needs_input: "需要补充资料",
  reviewing: "待审核",
  completed: "已完成",
  published: "已发布",
  failed: "失败",
  unknown: "状态未知",
  cancelled: "已取消",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function items(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function text(value: unknown, fallback = "待确认"): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return fallback;
}
function arrayText(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) =>
          typeof item === "string" ? item : text(record(item).text, ""),
        )
        .filter(Boolean)
    : [];
}
function ready(document: Source): boolean {
  return (
    document.status === "active" &&
    document.currentVersion?.storageStatus === "stored" &&
    document.currentVersion.ingestion.status === "succeeded" &&
    document.currentVersion.embedding.status === "succeeded"
  );
}

function sourceProcessingLabel(document: Source): string {
  if (ready(document)) return "可用于 AI";
  const ingestion = document.currentVersion?.ingestion.status;
  if (ingestion !== "succeeded") return `解析：${ingestion ?? "未知"}`;
  return `向量化：${document.currentVersion?.embedding.status ?? "未知"}`;
}

function apiError(value: unknown): string {
  const error = record(record(value).error);
  return text(
    error.message,
    text(error.code, "Product Map 请求失败，请稍后重试。"),
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(withBasePath(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(apiError(body)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body as T;
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function DetailList({ title, values }: { title: string; values: unknown }) {
  const rows = items(values);
  if (!rows.length) return null;
  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="text-xs font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {rows.slice(0, 30).map((value, index) => (
          <li key={text(value.id, String(index))}>
            <span className="font-medium text-foreground">
              {text(value.id, "-")}
            </span>{" "}
            {text(
              value.name,
              text(
                value.title,
                text(
                  value.description,
                  text(
                    value.statement,
                    text(
                      value.goal,
                      text(
                        value.role,
                        text(value.kind, text(value.stage, "待确认")),
                      ),
                    ),
                  ),
                ),
              ),
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArtifactPreview({
  artifact,
  versions,
}: {
  artifact: Artifact;
  versions: ArtifactVersion[];
}) {
  const content = record(artifact.content);
  const understanding = record(content.projectUnderstanding);
  const map = record(content.productMap);
  const analysis = record(content.analysisContract);
  const completeness = record(content.completeness);
  const inventory = record(content.materialInventory);
  const risks = record(content.risksAndQuestions);
  const citations = items(content.citations);
  const exceptions = items(analysis.exceptionPaths);
  const modules = items(map.modules);
  const structureReview = record(content.structureReview);
  const evidenceCoverage = record(analysis.evidenceCoverage);
  return (
    <div className="space-y-4" data-testid="product-map-result">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <p className="text-xs font-semibold text-primary">项目理解</p>
        <p className="mt-1 text-sm leading-6">
          {text(record(understanding.oneLinePositioning).text)}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          证据覆盖：{text(completeness.status)} · 已检索{" "}
          {text(completeness.retrievedEvidenceCount, "0")} 条
        </p>
      </div>
      <section className="rounded-lg border border-border p-3">
        <h3 className="text-xs font-semibold">PM 分析与证据摘要</h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          资料：
          {items(inventory.materials)
            .map((item) => text(item.fileName))
            .join("、") || "无"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          缺口：{arrayText(completeness.missingFields).join("、") || "无"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          CONFIRMED {text(evidenceCoverage.confirmed, "0")} · INFERRED{" "}
          {text(evidenceCoverage.inferred, "0")} · MISSING{" "}
          {text(evidenceCoverage.missing, "0")} · CONFLICT{" "}
          {text(evidenceCoverage.conflict, "0")} · N/A{" "}
          {text(evidenceCoverage.notApplicable, "0")}
        </p>
      </section>
      <DetailList title="目标" values={record(content.goals).goals} />
      <DetailList title="主流程" values={record(content.userPath).steps} />
      <section className="rounded-lg border border-border p-3">
        <h3 className="text-xs font-semibold">范围与角色</h3>
        <p className="mt-2 text-[11px]">
          In scope：
          {items(record(analysis.scope).inScope)
            .map((item) => text(item.statement))
            .join("、") || "待确认"}
        </p>
        <p className="mt-1 text-[11px]">
          Out of scope：
          {items(record(analysis.scope).outOfScope)
            .map((item) => text(item.statement))
            .join("、") || "待确认"}
        </p>
        <p className="mt-1 text-[11px]">
          TBD：
          {items(record(analysis.scope).tbd)
            .map((item) => text(item.statement))
            .join("、") || "无"}
        </p>
        <p className="mt-1 text-[11px]">
          角色：
          {items(analysis.roles)
            .map((role) => text(role.role))
            .join("、") || "待确认"}
        </p>
      </section>
      <section className="rounded-lg border border-border p-3">
        <h3 className="text-xs font-semibold">产品功能层级</h3>
        <div className="mt-2 space-y-2">
          {modules.map((module, index) => (
            <details
              key={text(module.id, String(index))}
              open
              className="rounded-md border border-border p-2"
            >
              <summary className="cursor-pointer text-xs font-medium">
                {text(module.id)} · {text(module.name)}
              </summary>
              <ul className="mt-2 space-y-1 border-l border-primary/20 pl-3 text-[11px] text-muted-foreground">
                {items(module.surfaces).map((surface, surfaceIndex) => (
                  <li key={text(surface.stableId, String(surfaceIndex))}>
                    <span className="font-medium text-foreground">
                      {text(surface.stableId)} · {text(surface.name)}
                    </span>
                    <ul className="ml-3 mt-1 list-disc">
                      {items(surface.features).map((feature, featureIndex) => (
                        <li key={text(feature.featureId, String(featureIndex))}>
                          {text(feature.featureId)} · Actions{" "}
                          {arrayText(feature.actionIds).join(", ")} · States{" "}
                          {arrayText(feature.stateIds).join(", ")}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </section>
      <DetailList title="页面" values={record(content.pages).pages} />
      <DetailList title="功能" values={record(content.features).features} />
      <DetailList
        title={`异常路径（${exceptions.length}/13）`}
        values={exceptions}
      />
      <DetailList
        title="风险与待确认"
        values={[...items(risks.questions), ...items(risks.risks)]}
      />
      <section className="rounded-lg border border-border p-3">
        <h3 className="text-xs font-semibold">引用</h3>
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {citations.length ? (
            citations.map((citation, index) => (
              <li key={text(citation.sourceId, String(index))}>
                {text(citation.citation)}
              </li>
            ))
          ) : (
            <li>暂无引用</li>
          )}
        </ul>
      </section>
      <section className="rounded-lg border border-border p-3">
        <h3 className="text-xs font-semibold">
          确定性 Structure Review ·{" "}
          {structureReview.passed === true ? "PASS" : "待确认"}
        </h3>
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {items(structureReview.issues).length ? (
            items(structureReview.issues).map((issue, index) => (
              <li key={`${text(issue.issue)}-${index}`}>
                [{text(issue.severity)}] {text(issue.issue)}：
                {text(issue.suggestion)}
              </li>
            ))
          ) : (
            <li>未发现结构问题。</li>
          )}
        </ul>
      </section>
      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Mermaid（文本预览）
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-[11px] leading-5 text-foreground">
          {artifact.mermaid || "暂无 Mermaid"}
        </pre>
      </details>
      <section className="rounded-lg border border-border p-3">
        <h3 className="text-xs font-semibold">版本历史</h3>
        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {versions.map((version) => (
            <li key={version.id ?? version.version}>
              v{version.version}
              {version.version === artifact.currentVersion
                ? "（当前）"
                : ""}{" "}
              {version.createdAt
                ? `· ${new Date(version.createdAt).toLocaleString()}`
                : ""}
            </li>
          ))}
        </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            download(
              "product-map.json",
              JSON.stringify(content, null, 2),
              "application/json",
            )
          }
        >
          下载 JSON
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            download(
              "product-map.md",
              artifact.markdown || "",
              "text/markdown;charset=utf-8",
            )
          }
        >
          下载 Markdown
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            download(
              "product-map.mmd",
              artifact.mermaid || "",
              "text/plain;charset=utf-8",
            )
          }
        >
          下载 Mermaid
        </Button>
      </div>
    </div>
  );
}

export function ProductMapWorkflowPanel({
  project,
  conversationId,
  contextReferences = [],
  open,
  onClose,
}: ProductMapWorkflowPanelProps) {
  const projectId = project.id;
  const referencedDocumentIds = useMemo(
    () =>
      contextReferences
        .filter(
          (reference): reference is Extract<AssistantContextReference, { type: "document" }> =>
            reference.type === "document",
        )
        .map((reference) => reference.documentId),
    [contextReferences],
  );
  const [skill, setSkill] = useState<Skill | null>(null);
  const [documents, setDocuments] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>(() => referencedDocumentIds);
  const [userInput, setUserInput] = useState("");
  const [includeConversationContext, setIncludeConversationContext] =
    useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(true);
  const [canManage, setCanManage] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const idempotencyKey = useRef<string>(crypto.randomUUID());
  const artifact = useMemo(() => detail?.artifacts?.[0] ?? null, [detail]);
  const versions = detail?.versions ?? [];
  const skillReady = Boolean(
    skill?.enabled &&
      skill.status === "active" &&
      !skill.availabilityCode,
  );
  const effectiveSelected = useMemo(
    () => [...new Set([...selected, ...referencedDocumentIds])],
    [referencedDocumentIds, selected],
  );

  const loadSources = useCallback(async () => {
    const sources = await request<{ documents?: Source[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/ai/sources`,
    );
    const combined = (sources.documents ?? []).map((document) => ({
      ...document,
      sourceScope:
        document.sourceScope ??
        (document.projectId === projectId ? "project" : "organization"),
    }));
    setDocuments(combined);
  }, [projectId]);
  const loadList = useCallback(async () => {
    const response = await request<WorkflowList>(
      `/api/projects/${encodeURIComponent(projectId)}/workflows`,
    );
    setRecentRuns(response.workflows ?? []);
    setSkill(
      (response.skills ?? []).find((item) => item.id === "product-map") ??
        null,
    );
  }, [projectId]);
  const loadDetail = useCallback(
    async (runId: string) => {
      const next = await request<Detail>(
        `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}`,
      );
      setDetail(next);
      setRun(next.run);
      setCanEdit(next.permissions?.canEdit ?? false);
      setCanManage(
        Boolean(next.permissions?.canReview && next.permissions?.canPublish),
      );
      if (next.artifacts[0])
        setJson(JSON.stringify(next.artifacts[0].content, null, 2));
      return next;
    },
    [projectId],
  );
  const refresh = useCallback(async () => {
    await Promise.all([loadSources(), loadList()]);
  }, [loadList, loadSources]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void refresh().catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "Product Map 配置加载失败",
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, refresh]);
  useEffect(() => {
    if (!open || !run || !ACTIVE.has(run.status)) return;
    const timer = window.setInterval(
      () =>
        void Promise.all([loadDetail(run.id), loadSources()]).catch(
          () => undefined,
        ),
      2_000,
    );
    return () => window.clearInterval(timer);
  }, [loadDetail, loadSources, open, run]);

  const openRun = async (runId: string) => {
    setError(null);
    try {
      const restored = await loadDetail(runId);
      if (ACTIVE.has(restored.run.status) && restored.permissions?.canEdit) {
        const resumed = await request<Detail>(
          `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}`,
          { method: "PATCH", body: JSON.stringify({ action: "resume" }) },
        );
        setDetail(resumed);
        setRun(resumed.run);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法恢复任务");
    }
  };
  const start = async () => {
    if (!skillReady) {
      setError("Product Map 尚未配置可用模型，请联系管理员。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await request<{ run: Run }>(
        `/api/projects/${encodeURIComponent(projectId)}/workflows`,
        {
          method: "POST",
          body: JSON.stringify({
            selectedSourceIds: effectiveSelected,
            userInput: userInput.trim() || undefined,
            conversationId: conversationId || undefined,
            contextReferences,
            includeConversationContext:
              Boolean(conversationId) && includeConversationContext,
            idempotencyKey: idempotencyKey.current,
          }),
        },
      );
      setRun(response.run);
      await loadDetail(response.run.id);
      await loadList();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Product Map 启动失败",
      );
    } finally {
      setBusy(false);
    }
  };
  const action = async (value: "cancel" | "retry" | "continue") => {
    if (!run || !canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<Detail>(
        `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(run.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: value,
            limitedEvidence: value === "continue",
          }),
        },
      );
      setDetail(response);
      setRun(response.run);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const attach = async (documentId: string) => {
    if (!run || !canEdit) return;
    setAttachingId(documentId);
    setError(null);
    try {
      await request<Detail>(
        `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(run.id)}/product-map/sources`,
        { method: "POST", body: JSON.stringify({ documentId }) },
      );
      setSelected((current) =>
        current.includes(documentId) ? current : [...current, documentId],
      );
      await loadDetail(run.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "附加资料失败，请刷新后重试");
    } finally {
      setAttachingId(null);
    }
  };
  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const listing = await listProjectDocuments(projectId, "active");
      const destination = listing.permissions.uploadDestinations.find(
        (item) => item.type === "project" && item.projectId === projectId,
      );
      if (!destination) throw new Error("当前项目没有可上传的资料空间。");
      const uploaded = await uploadProjectDocument({
        projectId,
        file,
        knowledgeSpaceId: destination.id,
        temporaryWorkflowId: run?.id,
        idempotencyKey: crypto.randomUUID(),
      });
      await refresh();
      setSelected((current) => [
        ...new Set([...current, uploaded.document.id]),
      ]);
      if (run) await attach(uploaded.document.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "资料上传失败");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const save = async () => {
    if (!run || !artifact || !canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const response = await request<Detail>(
        `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(artifact.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: "edit",
            expectedVersion: artifact.currentVersion,
            content: JSON.parse(json),
          }),
        },
      );
      setDetail(response);
      setRun(response.run);
    } catch (caught) {
      if ((caught as { status?: number }).status === 403) setCanEdit(false);
      setError(caught instanceof Error ? caught.message : "保存草稿失败");
    } finally {
      setSaving(false);
    }
  };
  const review = async (decision: "approve" | "reject") => {
    if (!run || !artifact || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<Detail>(
        `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(artifact.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ action: "review", decision }),
        },
      );
      setDetail(response);
      setRun(response.run);
    } catch (caught) {
      if ((caught as { status?: number }).status === 403) setCanManage(false);
      setError(caught instanceof Error ? caught.message : "审核失败");
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!run || !artifact || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      const response = await request<Detail>(
        `/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(artifact.id)}`,
        { method: "PATCH", body: JSON.stringify({ action: "publish" }) },
      );
      setDetail(response);
      setRun(response.run);
    } catch (caught) {
      if ((caught as { status?: number }).status === 403) setCanManage(false);
      setError(caught instanceof Error ? caught.message : "发布失败");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy && !uploading && !saving && !attachingId)
          onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-t-2xl border border-border bg-card p-0 shadow-2xl sm:rounded-2xl"
        data-testid="product-map-modal"
      >
        <input
          id="product-map-source-upload"
          ref={fileInput}
          className="hidden"
          type="file"
          aria-label="Product Map 补充资料"
          accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,text/plain,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <DialogHeader className="gap-0">
            <p className="text-xs font-medium text-primary">
              AI Skill · {skill?.version ?? "1.0.0"}
            </p>
            <DialogTitle className="mt-1 text-lg font-semibold">
              Product Map｜产品结构
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              只使用当前项目授权的项目与公司资料；结果始终先保存为可审核草稿。
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="关闭 Product Map"
              disabled={busy || uploading || saving || Boolean(attachingId)}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </DialogClose>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error ? (
            <div
              className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2.5 text-xs text-destructive"
              role="alert"
            >
              <AlertCircle className="size-3.5" />
              {error}
            </div>
          ) : null}
          {!run && skill && !skillReady ? (
            <div
              className="mb-4 rounded-lg border border-warning/20 bg-warning-soft px-3 py-2.5 text-xs text-foreground"
              role="status"
              data-testid="product-map-model-unavailable"
            >
              当前 Product Map 尚未配置可用的结构化文本模型。请管理员在“管理设置 → Provider 与模型”中为 Product Map｜产品结构选择已测试通过并支持 JSON 的模型后再开始。
            </div>
          ) : null}
          {!run ? (
            <div className="space-y-5" data-testid="product-map-configure">
              <section>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold">1. 选择授权资料</h3>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      项目资料与已发布公司资料均可使用；处理中资料不能开始执行。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    <FileUp className="size-3.5" />
                    上传资料
                  </Button>
                </div>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                  {documents.map((document) => {
                    const checked = effectiveSelected.includes(document.id);
                    const lockedReference = referencedDocumentIds.includes(
                      document.id,
                    );
                    return (
                      <label
                        key={document.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked ? "border-primary bg-primary/5" : "border-border"}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`选择资料 ${document.displayName}`}
                          checked={checked}
                          disabled={!ready(document) || lockedReference}
                          onChange={() =>
                            setSelected((current) =>
                              checked
                                ? current.filter((id) => id !== document.id)
                                : [...current, document.id],
                            )
                          }
                          className="mt-0.5 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {document.displayName}
                          </span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {document.sourceScope === "organization"
                              ? "公司资料"
                              : "项目资料"}{" "}
                            ·{" "}
                            {sourceProcessingLabel(document)}
                          </span>
                        </span>
                        {checked ? (
                          <Check className="size-4 text-primary" />
                        ) : null}
                        {lockedReference ? (
                          <span className="text-[10px] text-primary">
                            当前 $ 引用
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                  {!documents.length ? (
                    <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                      当前没有可用的授权资料。
                    </p>
                  ) : null}
                </div>
              </section>
              <section>
                <label
                  htmlFor="product-map-user-input"
                  className="text-xs font-semibold"
                >
                  2. 补充说明（可选）
                </label>
                <textarea
                  id="product-map-user-input"
                  aria-label="Product Map 补充说明"
                  value={userInput}
                  onChange={(event) => setUserInput(event.target.value)}
                  rows={4}
                  maxLength={20000}
                  className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                  placeholder="补充目标、用户、平台、核心需求或规则；不确定内容会标记为待确认。"
                />
                {conversationId ? (
                  <label
                    htmlFor="product-map-include-conversation"
                    className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs"
                  >
                    <Checkbox
                      id="product-map-include-conversation"
                      checked={includeConversationContext}
                      onCheckedChange={(checked) =>
                        setIncludeConversationContext(checked === true)
                      }
                    />
                    <span>
                      <span className="block font-medium">
                        将当前会话作为本次分析证据
                      </span>
                      <span className="mt-1 block leading-5 text-muted-foreground">
                        默认不读取会话。勾选后，受控会话摘要可能进入项目草稿；草稿发布前仅创建者和项目经理可查看。
                      </span>
                    </span>
                  </label>
                ) : null}
              </section>
              {recentRuns.length ? (
                <section>
                  <h3 className="text-xs font-semibold">恢复已有任务</h3>
                  <div className="mt-2 space-y-2">
                    {recentRuns.slice(0, 8).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-muted"
                        data-testid={`product-map-run-${item.id}`}
                        data-run-id={item.id}
                        onClick={() => void openRun(item.id)}
                      >
                        <span className="min-w-0">
                          <span className="block font-medium">
                            {STATUS_LABELS[item.status] ?? item.status} · 第 {item.currentStep}/8 步
                          </span>
                          <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                            {item.sourceCount} 份资料 · {item.createdAt ? new Date(item.createdAt).toLocaleString() : "时间未知"} · Run {item.id.slice(0, 8)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">继续查看</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-xs">
                  <ShieldCheck className="size-4 text-primary" />
                  <span>
                    状态：{STATUS_LABELS[run.status] ?? run.status} · 第 {run.currentStep}/8 步 · {run.sourceCount} 份资料
                  </span>
                </div>
                {canEdit && CANCELLABLE.has(run.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void action("cancel")}
                    disabled={busy}
                  >
                    取消运行
                  </Button>
                ) : null}
                {canEdit && run.status === "needs_input" ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void action("continue")}
                    disabled={busy}
                  >
                    基于现有证据继续
                  </Button>
                ) : null}
                {canEdit && ["failed", "unknown"].includes(run.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void action("retry")}
                    disabled={busy}
                  >
                    <RefreshCw className="size-3.5" />
                    重试
                  </Button>
                ) : null}
              </div>
              {ACTIVE.has(run.status) ? (
                  <div
                    className="grid gap-2 sm:grid-cols-2"
                    data-testid="product-map-running"
                    aria-live="polite"
                  >
                  {STEP_LABELS.map((label, index) => (
                    <div
                      key={label}
                      className={`rounded-md border px-3 py-2 text-xs ${run.currentStep >= index + 1 ? "border-primary/25 bg-primary/5" : "border-border text-muted-foreground"}`}
                    >
                      <span className="mr-2 text-[10px]">{index + 1}</span>
                      {label}
                    </div>
                  ))}
                </div>
              ) : null}
              {run.status === "needs_input" ? (
                <div className="rounded-lg border border-warning/20 bg-warning-soft p-3 text-xs">
                  资料不足或存在冲突。可以上传或附加资料后重试，或明确允许基于现有证据继续。
                </div>
              ) : null}
              {canEdit && ["needs_input", "failed", "unknown"].includes(run.status) ? (
                <section className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold">
                        为同一个 Run 补充资料
                      </h3>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        上传后等待 Parse 与 Embedding；任务会在原 Run 中恢复。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={uploading}
                      onClick={() => fileInput.current?.click()}
                    >
                      <FileUp className="size-3.5" />
                      上传并附加
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {documents
                      .filter(
                        (document) =>
                          !detail?.sources.some(
                            (source) =>
                              source.documentId === document.id &&
                              source.status !== "revoked",
                          ),
                      )
                      .slice(0, 12)
                      .map((document) => (
                        <Button
                          key={document.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void attach(document.id)}
                          disabled={busy || uploading || attachingId !== null}
                          loading={attachingId === document.id}
                        >
                          {document.sourceScope === "organization"
                            ? "公司"
                            : "项目"}{" "}
                          · {document.displayName}
                        </Button>
                      ))}
                  </div>
                </section>
              ) : null}
              {run.status === "failed" ? (
                <div className="rounded-lg border border-destructive/20 bg-destructive-soft p-3 text-xs">
                  {run.failureMessage || "运行失败，可在修正资料后重试。"}
                </div>
              ) : null}
              {run.status === "unknown" ? (
                <div className="rounded-lg border border-warning/20 bg-warning-soft p-3 text-xs">
                  {run.failureMessage ||
                    "模型响应状态未知；系统不会自动重试，请人工确认后再操作。"}
                </div>
              ) : null}
              {run.status === "cancelled" ? (
                <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
                  本次运行已取消，未发布任何正式资料。
                </div>
              ) : null}
              {artifact ? (
                <>
                  <ArtifactPreview artifact={artifact} versions={versions} />
                  <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-xs font-semibold">
                      编辑草稿 JSON（保存为新版本）
                    </summary>
                    <textarea
                      aria-label="Product Map 草稿编辑器"
                      value={json}
                      onChange={(event) => setJson(event.target.value)}
                      disabled={!canEdit || artifact.status === "published"}
                      className="mt-3 min-h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canEdit && artifact.status !== "published" ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void save()}
                          loading={saving}
                        >
                          保存新版本
                        </Button>
                      ) : null}
                      {canManage && artifact.status !== "published" ? (
                        <>
                          {artifact.status === "reviewed" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void review("reject")}
                              disabled={busy}
                            >
                              退回修改
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void review("approve")}
                              disabled={busy}
                            >
                              审核通过
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void publish()}
                            disabled={busy || artifact.status !== "reviewed"}
                          >
                            发布
                          </Button>
                        </>
                      ) : null}
                    </div>
                    {!canEdit ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        当前身份只能查看；编辑、审核和发布由授权项目成员完成。
                      </p>
                    ) : !canManage ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        你可以编辑草稿；审核和发布由项目经理完成。
                      </p>
                    ) : null}
                  </details>
                </>
              ) : null}
            </div>
          )}
        </div>
        {!run ? (
          <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
            <span className="text-[11px] text-muted-foreground">
              模型、资料权限与引用均由服务端控制。
            </span>
            <Button
              type="button"
              onClick={() => void start()}
              loading={busy}
              disabled={
                busy ||
                !skillReady ||
                (!effectiveSelected.length && !userInput.trim())
              }
            >
              <Play className="size-3.5" />
              检查资料并开始
            </Button>
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
