"use client";

import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { ProjectAssistantPanel } from "./ProjectAssistantPanel";

export function FocusedChatPage({ viewer }: { viewer: ViewerContext }) {
  const [projectId, setProjectId] = useState(viewer.projects[0]?.id ?? "");
  const project = useMemo(() => viewer.projects.find((item) => item.id === projectId) ?? viewer.projects[0] ?? null, [projectId, viewer.projects]);
  return <main className="min-h-full px-5 py-6 lg:px-8 lg:py-7"><header className="mb-5"><p className="mb-1 text-sm text-muted-foreground">有来源的项目问答</p><h1 className="text-2xl font-semibold tracking-tight">AI 对话</h1><p className="mt-1.5 text-sm text-muted-foreground">先选择项目，再明确使用项目资料、公司资料或两者。每条事实回答都必须带来源。</p></header>
    <section className="rounded-xl border bg-card p-4"><label className="flex flex-wrap items-center gap-3 text-sm font-medium"><span>当前项目</span><select value={project?.id ?? ""} onChange={(event) => setProjectId(event.target.value)} className="h-10 min-w-64 flex-1 rounded-lg border bg-background px-3"><option value="" disabled>请选择项目</option>{viewer.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section>
    {project ? <ProjectAssistantPanel key={project.id} project={project} focused /> : <div className="mt-5 grid min-h-80 place-items-center rounded-xl border bg-card text-center"><div><Bot className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 text-sm font-medium">暂无可访问项目</p><p className="mt-1 text-xs text-muted-foreground">加入项目后即可使用有来源的 AI 对话。</p></div></div>}
  </main>;
}
