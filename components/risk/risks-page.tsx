"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  LoaderCircle,
  Plus,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AuthorizedProjectSummary,
  ProjectMockPayload,
} from "@/lib/auth/ui-types";
import { listProjectDocuments } from "@/lib/documents/client";
import {
  projectManagementMutation,
  projectManagementRequest,
} from "@/lib/project-management/client";

type RiskStatus = "open" | "monitoring" | "mitigated" | "closed";
type Risk = {
  id: string;
  code: string;
  title: string;
  description: string;
  probability: number;
  impact: number;
  severity: number;
  ownerUserId: string | null;
  mitigation: string;
  trigger: string;
  status: RiskStatus;
  dueDate: string | null;
  relatedRequirementId: string | null;
  relatedActionItemId: string | null;
  currentVersion: number;
};
type Draft = Omit<
  Risk,
  "id" | "code" | "severity" | "status" | "currentVersion"
> & {
  id: string;
  status: string;
  sourceType: string;
  sourceCitation: Record<string, unknown>;
};
type Requirement = { id: string; code: string; title: string };
type Member = { userId: string; displayName: string };
type RiskFields = Omit<Risk, "id" | "code" | "severity" | "currentVersion">;
const empty: RiskFields = {
  title: "",
  description: "",
  probability: 2,
  impact: 2,
  ownerUserId: null,
  mitigation: "",
  trigger: "",
  status: "open",
  dueDate: null,
  relatedRequirementId: null,
  relatedActionItemId: null,
};

export function RisksPage({
  project,
}: {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}) {
  const [items, setItems] = useState<Risk[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [documents, setDocuments] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [sourceRequirementIds, setSourceRequirementIds] = useState<string[]>(
    [],
  );
  const [sourceDocumentIds, setSourceDocumentIds] = useState<string[]>([]);
  const [manual, setManual] = useState(empty);
  const [filter, setFilter] = useState<"all" | RiskStatus>("all");
  const [phase, setPhase] = useState<"loading" | "ready" | "working" | "error">(
    "loading",
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const [riskPayload, reqPayload, docs, memberPayload] = await Promise.all([
        projectManagementRequest<{ items: Risk[]; drafts: Draft[] }>(
          `/api/projects/${encodeURIComponent(project.id)}/risks`,
        ),
        projectManagementRequest<{ requirements: Requirement[] }>(
          `/api/projects/${encodeURIComponent(project.id)}/requirements`,
        ),
        listProjectDocuments(project.id, "active"),
        projectManagementRequest<{ members: Member[] }>(
          `/api/projects/${encodeURIComponent(project.id)}/members`,
        ),
      ]);
      setItems(riskPayload.items);
      setDrafts(riskPayload.drafts);
      setRequirements(reqPayload.requirements);
      setDocuments(
        docs.documents.map(({ id, displayName }) => ({ id, displayName })),
      );
      setMembers(memberPayload.members);
      setPhase("ready");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Risk 加载失败");
      setPhase("error");
    }
  }, [project.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visible = useMemo(
    () => items.filter((item) => filter === "all" || item.status === filter),
    [filter, items],
  );
  const pending = drafts.filter((draft) => draft.status === "pending_review");
  const canManage = project.permissions.canManageMembers;
  const memberName = (id: string | null) =>
    members.find((member) => member.userId === id)?.displayName ?? "未分配";
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
          `/api/projects/${encodeURIComponent(project.id)}/risks/drafts`,
          "POST",
          {
            requirementIds: sourceRequirementIds,
            documentIds: sourceDocumentIds,
          },
        ),
      "Risk 草稿已生成，尚未写入正式风险。 ",
    );
  const create = () =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/risks`,
          "POST",
          { fields: manual },
        ),
      "Risk 已手工创建。 ",
    );
  const review = (draft: Draft, decision: "accept" | "reject") =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/risks/drafts/${encodeURIComponent(draft.id)}/review`,
          "POST",
          {
            decision,
            note: "Reviewed in ProjectAI",
            fields:
              decision === "accept"
                ? {
                    title: draft.title,
                    description: draft.description,
                    probability: draft.probability,
                    impact: draft.impact,
                    ownerUserId: draft.ownerUserId,
                    mitigation: draft.mitigation,
                    trigger: draft.trigger,
                    status: "open",
                    dueDate: draft.dueDate,
                    relatedRequirementId: draft.relatedRequirementId,
                    relatedActionItemId: draft.relatedActionItemId,
                  }
                : undefined,
          },
        ),
      decision === "accept" ? "Risk 草稿已人工接受。" : "Risk 草稿已拒绝。 ",
    );
  const updateStatus = (item: Risk, status: RiskStatus) =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/risks`,
          "PATCH",
          {
            riskId: item.id,
            fields: { ...item, status },
            changeReason: "status_update",
          },
        ),
      "Risk 状态已更新。 ",
    );
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
          <ShieldAlert className="size-3.5" /> 概率 × 影响矩阵
        </p>
        <h1 className="mt-1 text-2xl font-semibold">风险管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI 风险先进入 Draft；人工确认后保留来源、缓解措施与完整状态历史。
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
      {canManage ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              AI 识别 Risk Draft
            </h2>
            <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {requirements.map((item) => (
                <Source
                  key={item.id}
                  id={item.id}
                  label={`${item.code} ${item.title}`}
                  selected={sourceRequirementIds}
                  setSelected={setSourceRequirementIds}
                />
              ))}
              {documents.map((item) => (
                <Source
                  key={item.id}
                  id={item.id}
                  label={item.displayName}
                  selected={sourceDocumentIds}
                  setSelected={setSourceDocumentIds}
                />
              ))}
            </div>
            <button
              disabled={
                !sourceRequirementIds.length && !sourceDocumentIds.length
              }
              onClick={() => void generate()}
              className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              生成 Risk Draft
            </button>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="size-4 text-primary" />
              手工登记风险
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                value={manual.title}
                onChange={(e) =>
                  setManual({ ...manual, title: e.target.value })
                }
                placeholder="标题"
                className="h-9 rounded-lg border border-input px-3 text-xs"
              />
              <select
                value={manual.ownerUserId ?? ""}
                onChange={(e) =>
                  setManual({ ...manual, ownerUserId: e.target.value || null })
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-xs"
              >
                <option value="">未分配</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
              <textarea
                value={manual.description}
                onChange={(e) =>
                  setManual({ ...manual, description: e.target.value })
                }
                placeholder="描述"
                className="rounded-lg border border-input p-3 text-xs sm:col-span-2"
              />
              <input
                value={manual.mitigation}
                onChange={(e) =>
                  setManual({ ...manual, mitigation: e.target.value })
                }
                placeholder="缓解措施"
                className="h-9 rounded-lg border border-input px-3 text-xs"
              />
              <input
                value={manual.trigger}
                onChange={(e) =>
                  setManual({ ...manual, trigger: e.target.value })
                }
                placeholder="触发条件"
                className="h-9 rounded-lg border border-input px-3 text-xs"
              />
              <select
                value={manual.probability}
                onChange={(e) =>
                  setManual({ ...manual, probability: Number(e.target.value) })
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-xs"
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    概率 {value}
                  </option>
                ))}
              </select>
              <select
                value={manual.impact}
                onChange={(e) =>
                  setManual({ ...manual, impact: Number(e.target.value) })
                }
                className="h-9 rounded-lg border border-input bg-background px-3 text-xs"
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    影响 {value}
                  </option>
                ))}
              </select>
            </div>
            <button
              disabled={
                !manual.title ||
                !manual.description ||
                !manual.mitigation ||
                !manual.trigger
              }
              onClick={() => void create()}
              className="mt-3 rounded-lg border border-primary px-3 py-2 text-xs font-medium text-primary disabled:opacity-40"
            >
              创建正式 Risk
            </button>
          </div>
        </section>
      ) : null}
      {pending.length ? (
        <section className="rounded-xl border border-warning/30 bg-warning-soft p-5">
          <h2 className="text-sm font-semibold">
            待审核 Risk Draft · {pending.length}
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {pending.map((draft) => (
              <article
                key={draft.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium">{draft.title}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${draft.probability * draft.impact >= 16 ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}
                  >
                    {draft.probability} × {draft.impact}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {draft.description}
                </p>
                <p className="mt-2 text-[10px] text-primary">
                  缓解：{draft.mitigation}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void review(draft, "accept")}
                    className="inline-flex items-center gap-1 rounded-lg bg-success px-3 py-1.5 text-xs text-white"
                  >
                    <Check className="size-3" />
                    接受
                  </button>
                  <button
                    onClick={() => void review(draft, "reject")}
                    className="inline-flex items-center gap-1 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs text-destructive"
                  >
                    <X className="size-3" />
                    拒绝
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border p-4">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="all">全部状态</option>
              <option value="open">Open</option>
              <option value="monitoring">Monitoring</option>
              <option value="mitigated">Mitigated</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className="divide-y divide-border">
            {visible.map((item) => (
              <article
                key={item.id}
                className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_100px_130px]"
              >
                <div>
                  <p className="font-mono text-[10px] text-primary">
                    {item.code}
                  </p>
                  <h3 className="text-sm font-medium">{item.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                  <p className="mt-2 text-[10px] text-primary">
                    Mitigation：{item.mitigation}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Owner</p>
                  <p className="mt-1 text-xs">{memberName(item.ownerUserId)}</p>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Severity {item.severity}
                  </p>
                </div>
                <select
                  aria-label={`${item.code} 状态`}
                  disabled={!canManage}
                  value={item.status}
                  onChange={(e) =>
                    void updateStatus(item, e.target.value as RiskStatus)
                  }
                  className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                >
                  <option value="open">Open</option>
                  <option value="monitoring">Monitoring</option>
                  <option value="mitigated">Mitigated</option>
                  <option value="closed">Closed</option>
                </select>
              </article>
            ))}
          </div>
        </div>
        <RiskMatrix items={items} />
      </section>
    </div>
  );
}

function RiskMatrix({ items }: { items: Risk[] }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Risk Matrix</h2>
      <div className="mt-4 grid grid-cols-5 gap-1">
        {[5, 4, 3, 2, 1].flatMap((impact) =>
          [1, 2, 3, 4, 5].map((probability) => {
            const count = items.filter(
              (item) =>
                item.impact === impact &&
                item.probability === probability &&
                item.status !== "closed",
            ).length;
            const score = impact * probability;
            return (
              <div
                key={`${impact}-${probability}`}
                title={`概率 ${probability} / 影响 ${impact}`}
                className={`grid aspect-square place-items-center rounded text-xs font-semibold ${score >= 16 ? "bg-destructive/20 text-destructive" : score >= 8 ? "bg-warning/20 text-warning" : "bg-success/15 text-success"}`}
              >
                {count || ""}
              </div>
            );
          }),
        )}
      </div>
      <div className="mt-2 flex justify-between text-[9px] text-muted-foreground">
        <span>低概率</span>
        <span>高概率</span>
      </div>
    </section>
  );
}
function Source({
  id,
  label,
  selected,
  setSelected,
}: {
  id: string;
  label: string;
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const checked = selected.includes(id);
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] ${checked ? "border-primary text-primary" : "border-border"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() =>
          setSelected((current) =>
            checked
              ? current.filter((value) => value !== id)
              : [...current, id],
          )
        }
        className="accent-primary"
      />
      {label}
    </label>
  );
}
export default RisksPage;
