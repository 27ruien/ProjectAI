"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { EnvironmentBanner } from "./environment-banner";
import { ToastProvider } from "@/components/common/toast";
import { FeedbackDrawer } from "@/components/feedback";
import { cn } from "@/lib/utils";
import {
  setLocalStorageSnapshot,
  useLocalStorageSnapshot,
} from "@/lib/browser-snapshot";
import { storageKey } from "@/lib/storage-key";
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
  const sidebarStorageKey = storageKey("sidebar");
  const collapsed = useLocalStorageSnapshot(sidebarStorageKey) === "collapsed";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const changeCollapsed = (value: boolean) => {
    setLocalStorageSnapshot(sidebarStorageKey, value ? "collapsed" : "expanded");
  };
  const readOnly = currentProject ? !currentProject.permissions.canEditProject : false;
  return <ToastProvider><div className="min-h-screen bg-background"><Sidebar viewer={viewer} currentPath={currentPath} collapsed={collapsed} onCollapsedChange={changeCollapsed} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} featureFlags={featureFlags} /><div className={cn("min-h-screen transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[232px]")}><EnvironmentBanner /><Topbar viewer={viewer} currentProject={currentProject} currentPath={currentPath} onMenuOpen={() => setMobileOpen(true)} onFeedbackOpen={() => setFeedbackOpen(true)} />{readOnly ? <div className="flex min-h-9 items-center justify-center gap-2 border-b border-info/15 bg-info-soft px-4 py-2 text-center text-xs text-info" role="status"><Eye className="size-3.5" />你以只读成员身份访问此项目，修改、审核和删除操作已关闭。</div> : null}<main className="min-h-[calc(100vh-64px)]"><div className="mx-auto w-full max-w-[1540px] page-enter">{children}</div></main></div><FeedbackDrawer currentPath={currentPath} open={feedbackOpen} onClose={() => setFeedbackOpen(false)} /></div></ToastProvider>;
}
