"use client";

import type { ViewerContext } from "@/lib/auth/ui-types";
import { ProjectAssistantPanel } from "./ProjectAssistantPanel";

export function FocusedChatPage({ viewer }: { viewer: ViewerContext }) {
  return (
    <main className="min-h-full px-5 py-7 sm:px-6 lg:px-8" data-testid="focused-chat-page">
      <header className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">AI 助手</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          直接提问、写作或分析；涉及项目事实和公司规范时，助手会按你的权限自动查找相关资料。
        </p>
      </header>
      <ProjectAssistantPanel project={null} focused viewer={viewer} />
    </main>
  );
}
