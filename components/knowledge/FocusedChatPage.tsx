"use client";

import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { ProjectAssistantPanel } from "./ProjectAssistantPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FocusedChatPage({ viewer }: { viewer: ViewerContext }) {
  const [projectId, setProjectId] = useState(viewer.projects[0]?.id ?? "");
  const project = useMemo(() => viewer.projects.find((item) => item.id === projectId) ?? viewer.projects[0] ?? null, [projectId, viewer.projects]);
  return <main className="min-h-full px-5 py-7 sm:px-6 lg:px-8" data-testid="focused-chat-page"><header className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">AI 对话</h1><p className="mt-1.5 text-sm text-muted-foreground">基于当前项目和公司资料提问，每条事实回答都附带来源。</p></div><label className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span>当前项目</span><Select value={project?.id ?? ""} onValueChange={setProjectId}><SelectTrigger className="w-64 max-w-[65vw]"><SelectValue placeholder="请选择项目" /></SelectTrigger><SelectContent>{viewer.projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label></header>
    {project ? <ProjectAssistantPanel key={project.id} project={project} focused /> : <div className="mt-5 grid min-h-80 place-items-center rounded-xl border bg-card text-center"><div><Bot className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 text-sm font-medium">暂无可访问项目</p><p className="mt-1 text-xs text-muted-foreground">加入项目后即可使用有来源的 AI 对话。</p></div></div>}
  </main>;
}
