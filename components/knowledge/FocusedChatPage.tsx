"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { ProjectAssistantPanel } from "./ProjectAssistantPanel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FocusedChatPage({ viewer }: { viewer: ViewerContext }) {
  const generalScope = "__general__";
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project") ?? "";
  const initialProjectId = viewer.projects.some((item) => item.id === requestedProjectId) ? requestedProjectId : generalScope;
  const [projectId, setProjectId] = useState(initialProjectId);
  const project = useMemo(() => viewer.projects.find((item) => item.id === projectId) ?? null, [projectId, viewer.projects]);
  return <main className="min-h-full px-5 py-7 sm:px-6 lg:px-8" data-testid="focused-chat-page"><header className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight">会话</h2><p className="mt-1.5 text-sm text-muted-foreground">通用会话可直接提问；选择项目后，系统会自动使用最新项目资料和相关常规模板。</p></div><label className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><span>会话范围</span><Select value={projectId} onValueChange={setProjectId}><SelectTrigger className="w-64 max-w-[65vw]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={generalScope}>通用会话（不使用知识库）</SelectItem>{viewer.projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label></header>
    <ProjectAssistantPanel key={project?.id ?? generalScope} project={project} focused />
  </main>;
}
