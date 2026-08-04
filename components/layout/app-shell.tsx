"use client";

import { useState, type ReactNode } from "react";
import { Alert, AppShell as MantineAppShell, Box } from "@mantine/core";
import { Eye } from "lucide-react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ToastProvider } from "@/components/common/toast";
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
  return (
    <ToastProvider>
      <MantineAppShell
        header={{ height: 56 }}
        navbar={{ width: 240, breakpoint: "lg", collapsed: { mobile: !mobileOpen } }}
        padding={0}
        bg="var(--mantine-color-gray-0)"
      >
        <MantineAppShell.Header bg="rgba(255,255,255,.94)" style={{ backdropFilter: "blur(12px)" }}>
          <Topbar currentProject={currentProject} currentPath={currentPath} onMenuOpen={() => setMobileOpen(true)} />
        </MantineAppShell.Header>
        <MantineAppShell.Navbar bg="white">
          <Sidebar viewer={viewer} currentPath={currentPath} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
        </MantineAppShell.Navbar>
        <MantineAppShell.Main>
          {readOnly ? <Alert radius={0} color="projectBlue" icon={<Eye size={15} />}>你以只读成员身份访问此项目，修改、审核和删除操作已关闭。</Alert> : null}
          <Box component="main" mih="calc(100vh - 56px)" maw={1600} mx="auto">{children}</Box>
        </MantineAppShell.Main>
      </MantineAppShell>
    </ToastProvider>
  );
}
