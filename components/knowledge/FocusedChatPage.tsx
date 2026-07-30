"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot } from "lucide-react";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { ProjectAssistantPanel } from "./ProjectAssistantPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FocusedChatPage({ viewer }: { viewer: ViewerContext }) {
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project") ?? "";
  const initialProjectId = viewer.projects.some((item) => item.id === requestedProjectId) ? requestedProjectId : viewer.projects[0]?.id ?? "";
  const [projectId, setProjectId] = useState(initialProjectId);
  const project = useMemo(() => viewer.projects.find((item) => item.id === projectId) ?? viewer.projects[0] ?? null, [projectId, viewer.projects]);
  return <main className="min-h-full px-5 py-7 sm:px-6 lg:px-8" data-testid="focused-chat-page"><header className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight">会话</h2><p className="mt-1.5 text-sm text-muted-foreground">选择项目后，系统自动使用最新项目资料与有权访问的相关常规模板。</p></div><label className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span>当前项目</span><Select value={project?.id ?? ""} onValueChange={setProjectId}><SelectTrigger className="w-64 max-w-[65vw]"><SelectValue placeholder="请选择项目" /></SelectTrigger><SelectContent>{viewer.projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label></header>
    {project ? <ProjectAssistantPanel key={project.id} project={project} focused /> : <div className="mt-5 grid min-h-80 place-items-center rounded-xl border bg-card text-center"><div><Bot className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 text-sm font-medium">暂无可访问项目</p><p className="mt-1 text-xs text-muted-foreground">加入项目后即可使用有来源的 AI 对话。</p></div></div>}
  </main>;
}
