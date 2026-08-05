"use client";

import { useState, type ReactNode } from "react";
import { Eye } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ToastProvider } from "@/components/common/toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { AuthorizedProjectSummary, ViewerContext } from "@/lib/auth/ui-types";
import { cn } from "@/lib/utils";

interface AppShellProps {
  viewer: ViewerContext;
  currentProject?: AuthorizedProjectSummary;
  currentPath: string;
  children: ReactNode;
  featureFlags: { pmDailyReport: boolean; wecomTimesheetSync: boolean };
}

export function AppShell({ viewer, currentProject, currentPath, children, featureFlags }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const readOnly = currentProject ? !currentProject.permissions.canEditProject : false;
  void featureFlags;

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-background text-foreground">
        <aside className={cn("fixed inset-y-0 left-0 z-40 hidden border-r bg-sidebar transition-[width] lg:block", sidebarCollapsed ? "w-16" : "w-64")}>
          <Sidebar viewer={viewer} currentPath={currentPath} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((value) => !value)} onMobileClose={() => undefined} />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 gap-0 p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">ProjectAI 导航</SheetTitle>
            <SheetDescription className="sr-only">移动端主导航与账户菜单</SheetDescription>
            <Sidebar viewer={viewer} currentPath={currentPath} collapsed={false} onMobileClose={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className={cn("transition-[padding]", sidebarCollapsed ? "lg:pl-16" : "lg:pl-64")}>
          <header className="sticky top-0 z-30 h-14 border-b bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/75">
            <Topbar currentProject={currentProject} currentPath={currentPath} onMenuOpen={() => setMobileOpen(true)} />
          </header>
          {readOnly ? (
            <Alert className="rounded-none border-x-0 border-t-0 bg-info-soft text-info">
              <Eye aria-hidden className="size-4" />
              <AlertDescription>你以只读成员身份访问此项目，修改、审核和删除操作已关闭。</AlertDescription>
            </Alert>
          ) : null}
          <main className="mx-auto min-h-[calc(100dvh-3.5rem)] max-w-[1600px]">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
