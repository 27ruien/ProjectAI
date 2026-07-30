"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ToastProvider } from "@/components/common/toast";
import { Eye } from "lucide-react";
import type { AuthorizedProjectSummary, ViewerContext } from "@/lib/auth/ui-types";

interface AppShellProps {
  viewer: ViewerContext;
  currentProject?: AuthorizedProjectSummary;
  currentPath: string;
  children: ReactNode;
  featureFlags: { pmDailyReport: boolean; wecomTimesheetSync: boolean };
}

export function AppShell({ viewer, currentProject, currentPath, children, featureFlags }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const readOnly = currentProject ? !currentProject.permissions.canEditProject : false;
  void featureFlags;
  return <ToastProvider><div className="min-h-screen bg-background"><Sidebar viewer={viewer} currentPath={currentPath} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} /><div className="min-h-screen lg:pl-60"><Topbar currentProject={currentProject} currentPath={currentPath} onMenuOpen={() => setMobileOpen(true)} />{readOnly ? <div className="flex min-h-9 items-center justify-center gap-2 border-b border-info/15 bg-info-soft px-4 py-2 text-center text-xs text-info" role="status"><Eye className="size-3.5" />你以只读成员身份访问此项目，修改、审核和删除操作已关闭。</div> : null}<main className="min-h-[calc(100vh-56px)]"><div className="mx-auto w-full max-w-7xl page-enter">{children}</div></main></div></div></ToastProvider>;
}
