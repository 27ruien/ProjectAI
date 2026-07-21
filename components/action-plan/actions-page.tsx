"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Link2,
  ListTodo,
  LoaderCircle,
  Plus,
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

type ActionStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type Action = {
  id: string;
  code: string;
  title: string;
  description: string;
  ownerUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: ActionStatus;
  priority: "low" | "medium" | "high" | "critical";
  progress: number;
  blocker: string;
  relatedRequirementId: string | null;
  relatedScopeItemId: string | null;
  currentVersion: number;
};
type Draft = {
  id: string;
  title: string;
  description: string;
  ownerUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  priority: Action["priority"];
  blocker: string;
  sourceType: string;
  sourceCitation: Record<string, unknown>;
  relatedRequirementId: string | null;
  relatedScopeItemId: string | null;
  status: string;
};
type Member = { userId: string; displayName: string; role: string };
type Requirement = { id: string; code: string; title: string };
type Payload = {
  items: Action[];
  drafts: Draft[];
  dependencies: Array<{
    id: string;
    actionItemId: string;
    dependsOnActionItemId: string;
  }>;
  projectRole: string | null;
  actorUserId: string;
};

function emptyAction(): Omit<Action, "id" | "code" | "currentVersion"> {
  return {
    title: "",
    description: "",
    ownerUserId: null,
    startDate: null,
    dueDate: null,
    status: "todo",
    priority: "medium",
    progress: 0,
    blocker: "",
    relatedRequirementId: null,
    relatedScopeItemId: null,
  };
}

export function ActionsPage({
  project,
}: {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}) {
  const [payload, setPayload] = useState<Payload>({
    items: [],
    drafts: [],
    dependencies: [],
    projectRole: null,
    actorUserId: "",
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [documents, setDocuments] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [sourceRequirementIds, setSourceRequirementIds] = useState<string[]>(
    [],
  );
  const [sourceDocumentIds, setSourceDocumentIds] = useState<string[]>([]);
  const [manual, setManual] = useState(emptyAction());
  const [selected, setSelected] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | ActionStatus>("all");
  const [sort, setSort] = useState<"due" | "priority" | "progress">("due");
  const [dependency, setDependency] = useState({
    actionItemId: "",
    dependsOnActionItemId: "",
  });
  const [phase, setPhase] = useState<"loading" | "ready" | "working" | "error">(
    "loading",
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const [actions, memberPayload, requirementPayload, docs] =
        await Promise.all([
          projectManagementRequest<Payload>(
            `/api/projects/${encodeURIComponent(project.id)}/actions`,
          ),
          projectManagementRequest<{ members: Member[] }>(
            `/api/projects/${encodeURIComponent(project.id)}/members`,
          ),
          projectManagementRequest<{ requirements: Requirement[] }>(
            `/api/projects/${encodeURIComponent(project.id)}/requirements`,
          ),
          listProjectDocuments(project.id, "active"),
        ]);
      setPayload(actions);
      setMembers(memberPayload.members);
      setRequirements(requirementPayload.requirements);
      setDocuments(
        docs.documents.map(({ id, displayName }) => ({ id, displayName })),
      );
      setPhase("ready");
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Action 数据加载失败",
      );
      setPhase("error");
    }
  }, [project.id]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = useMemo(
    () =>
      payload.items
        .filter(
          (item) => statusFilter === "all" || item.status === statusFilter,
        )
        .sort((a, b) =>
          sort === "due"
            ? String(a.dueDate ?? "9999").localeCompare(
                String(b.dueDate ?? "9999"),
              )
            : sort === "priority"
              ? { critical: 0, high: 1, medium: 2, low: 3 }[a.priority] -
                { critical: 0, high: 1, medium: 2, low: 3 }[b.priority]
              : b.progress - a.progress,
        ),
    [payload.items, sort, statusFilter],
  );
  const pendingDrafts = payload.drafts.filter(
    (draft) => draft.status === "pending_review",
  );
  const canManage = project.permissions.canManageMembers;
  const canWrite = project.permissions.canEditProject;
  const canUpdate = (item: Action) =>
    canManage ||
    (payload.projectRole === "project_member" &&
      item.ownerUserId === payload.actorUserId);
  const memberName = (id: string | null) =>
    members.find((member) => member.userId === id)?.displayName ?? "未分配";
  const run = async (operation: () => Promise<unknown>, success: string) => {
    setPhase("working");
    setFeedback(null);
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
          `/api/projects/${encodeURIComponent(project.id)}/actions/drafts`,
          "POST",
          {
            requirementIds: sourceRequirementIds,
            documentIds: sourceDocumentIds,
          },
        ),
      "Action 草稿已生成，尚未写入正式任务。",
    );
  const review = (draft: Draft, decision: "accept" | "reject") =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/actions/drafts/${encodeURIComponent(draft.id)}/review`,
          "POST",
          {
            decision,
            note: "Reviewed in ProjectAI",
            fields:
              decision === "accept"
                ? {
                    title: draft.title,
                    description: draft.description,
                    ownerUserId: draft.ownerUserId,
                    startDate: draft.startDate,
                    dueDate: draft.dueDate,
                    status: "todo",
                    priority: draft.priority,
                    progress: 0,
                    blocker: draft.blocker,
                    relatedRequirementId: draft.relatedRequirementId,
                    relatedScopeItemId: draft.relatedScopeItemId,
                  }
                : undefined,
          },
        ),
      decision === "accept"
        ? "Action 草稿已人工接受。"
        : "Action 草稿已拒绝，未创建正式任务。",
    );
  const create = () =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/actions`,
          "POST",
          { fields: manual },
        ),
      "Action 已手工创建。 ",
    );
  const updateStatus = (item: Action, status: ActionStatus) =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/actions`,
          "PATCH",
          {
            actionItemId: item.id,
            fields: {
              ...item,
              status,
              progress: status === "done" ? 100 : item.progress,
            },
            changeReason: "status_update",
          },
        ),
      "Action 状态已更新。 ",
    );
  const bulk = (status: ActionStatus) =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/actions/bulk`,
          "POST",
          { actionItemIds: selected, status },
        ),
      `已更新 ${selected.length} 条 Action。`,
    );
  const addDependency = () =>
    run(
      () =>
        projectManagementMutation(
          `/api/projects/${encodeURIComponent(project.id)}/actions/dependencies`,
          "POST",
          dependency,
        ),
      "依赖已添加并完成环检测。 ",
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
          <ListTodo className="size-3.5" /> 正式任务与 AI 草稿隔离
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Action Plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          手工任务可直接创建；AI 生成内容必须由项目经理审核后才成为正式 Action。
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
      {canWrite ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              从需求或会议资料生成 Draft
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
                phase === "working" ||
                (!sourceRequirementIds.length && !sourceDocumentIds.length)
              }
              onClick={() => void generate()}
              className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
            >
              生成待审核 Action
            </button>
          </div>
          {canManage ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Plus className="size-4 text-primary" />
                手工创建
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <input
                  placeholder="标题"
                  value={manual.title}
                  onChange={(e) =>
                    setManual({ ...manual, title: e.target.value })
                  }
                  className="h-9 rounded-lg border border-input px-3 text-xs"
                />
                <select
                  value={manual.ownerUserId ?? ""}
                  onChange={(e) =>
                    setManual({
                      ...manual,
                      ownerUserId: e.target.value || null,
                    })
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
                  placeholder="描述"
                  value={manual.description}
                  onChange={(e) =>
                    setManual({ ...manual, description: e.target.value })
                  }
                  className="rounded-lg border border-input p-3 text-xs sm:col-span-2"
                />
                <input
                  type="date"
                  value={manual.dueDate ?? ""}
                  onChange={(e) =>
                    setManual({ ...manual, dueDate: e.target.value || null })
                  }
                  className="h-9 rounded-lg border border-input px-3 text-xs"
                />
                <select
                  value={manual.priority}
                  onChange={(e) =>
                    setManual({
                      ...manual,
                      priority: e.target.value as Action["priority"],
                    })
                  }
                  className="h-9 rounded-lg border border-input bg-background px-3 text-xs"
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="critical">紧急</option>
                </select>
              </div>
              <button
                onClick={() => void create()}
                disabled={!manual.title || !manual.description}
                className="mt-3 rounded-lg border border-primary px-3 py-2 text-xs font-medium text-primary disabled:opacity-40"
              >
                创建正式 Action
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {pendingDrafts.length ? (
        <section className="rounded-xl border border-warning/30 bg-warning-soft p-5">
          <h2 className="text-sm font-semibold">
            待审核 Action Draft · {pendingDrafts.length}
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {pendingDrafts.map((draft) => (
              <article
                key={draft.id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <h3 className="text-sm font-medium">{draft.title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {draft.description}
                </p>
                <p className="mt-2 text-[10px] text-primary">
                  来源：{draft.sourceType}
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
      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="all">全部状态</option>
              <option value="todo">待开始</option>
              <option value="in_progress">进行中</option>
              <option value="blocked">阻塞</option>
              <option value="done">完成</option>
              <option value="cancelled">取消</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="due">按截止日期</option>
              <option value="priority">按优先级</option>
              <option value="progress">按进度</option>
            </select>
          </div>
          {selected.length ? (
            <div className="flex gap-2">
              <button
                onClick={() => void bulk("in_progress")}
                className="rounded-lg border px-2 py-1 text-xs"
              >
                批量进行中
              </button>
              <button
                onClick={() => void bulk("done")}
                className="rounded-lg border border-success/30 px-2 py-1 text-xs text-success"
              >
                批量完成
              </button>
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/30 text-[10px] text-muted-foreground">
              <tr>
                <th className="p-3">选择</th>
                <th className="p-3">Action</th>
                <th className="p-3">Owner</th>
                <th className="p-3">Deadline</th>
                <th className="p-3">Progress</th>
                <th className="p-3">Status</th>
                <th className="p-3">依赖</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((item) => (
                <tr key={item.id}>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${item.code}`}
                      disabled={!canUpdate(item)}
                      checked={selected.includes(item.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(item.id)
                            ? current.filter((id) => id !== item.id)
                            : [...current, item.id],
                        )
                      }
                      className="accent-primary"
                    />
                  </td>
                  <td className="p-3">
                    <p className="font-mono text-[10px] text-primary">
                      {item.code}
                    </p>
                    <p className="font-medium">{item.title}</p>
                    {item.blocker ? (
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-destructive">
                        <AlertTriangle className="size-3" />
                        {item.blocker}
                      </p>
                    ) : null}
                  </td>
                  <td className="p-3">{memberName(item.ownerUserId)}</td>
                  <td className="p-3">{item.dueDate ?? "—"}</td>
                  <td className="p-3">{item.progress}%</td>
                  <td className="p-3">
                    <select
                      aria-label={`${item.code} 状态`}
                      disabled={!canUpdate(item)}
                      value={item.status}
                      onChange={(e) =>
                        void updateStatus(item, e.target.value as ActionStatus)
                      }
                      className="rounded border border-input bg-background p-1 text-xs"
                    >
                      <option value="todo">待开始</option>
                      <option value="in_progress">进行中</option>
                      <option value="blocked">阻塞</option>
                      <option value="done">完成</option>
                      <option value="cancelled">取消</option>
                    </select>
                  </td>
                  <td className="p-3 text-[10px] text-muted-foreground">
                    {payload.dependencies
                      .filter((dep) => dep.actionItemId === item.id)
                      .map(
                        (dep) =>
                          payload.items.find(
                            (target) => target.id === dep.dependsOnActionItemId,
                          )?.code,
                      )
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {canManage && payload.items.length > 1 ? (
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4" />
            添加依赖
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={dependency.actionItemId}
              onChange={(e) =>
                setDependency({ ...dependency, actionItemId: e.target.value })
              }
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="">Action</option>
              {payload.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code}
                </option>
              ))}
            </select>
            <span className="py-2 text-xs">依赖</span>
            <select
              value={dependency.dependsOnActionItemId}
              onChange={(e) =>
                setDependency({
                  ...dependency,
                  dependsOnActionItemId: e.target.value,
                })
              }
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="">前置 Action</option>
              {payload.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code}
                </option>
              ))}
            </select>
            <button
              disabled={
                !dependency.actionItemId || !dependency.dependsOnActionItemId
              }
              onClick={() => void addDependency()}
              className="rounded-lg border px-3 text-xs disabled:opacity-40"
            >
              添加
            </button>
          </div>
        </section>
      ) : null}
    </div>
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

export default ActionsPage;
