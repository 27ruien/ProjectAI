"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  FolderKanban,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { initials } from "@/components/project/mock-view";
import { navigateToLogin, signOut } from "@/components/auth/auth-client";
import { productRoleLabel, type ViewerContext } from "@/lib/auth/ui-types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarProps {
  viewer: ViewerContext;
  currentPath: string;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onMobileClose: () => void;
}

export function Sidebar({ viewer, currentPath, collapsed, onToggleCollapse, onMobileClose }: SidebarProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const active = currentPath === "/projects" || currentPath.startsWith("/projects/");
  const admin = viewer.user.systemRole === "system_admin" || viewer.user.productRole === "admin" || viewer.user.productRole === "super_admin";
  const link = (
    <Link
      href="/projects"
      onClick={onMobileClose}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors",
        collapsed && "justify-center px-0",
        active ? "bg-sidebar-accent font-medium text-sidebar-foreground before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
      )}
    >
      <FolderKanban className="size-4" />
      <span className={cn("flex-1", collapsed && "sr-only")}>项目</span>
    </Link>
  );
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
      navigateToLogin();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <div className={cn("flex h-12 items-center gap-2 border-b px-3", collapsed && "justify-center px-2")}>
          <span className="grid size-7 place-items-center rounded-md border bg-background text-primary"><Sparkles className="size-3.5" /></span>
          <Link href="/projects" onClick={onMobileClose} className={cn("text-sm font-semibold tracking-tight", collapsed && "sr-only")}>Project AI</Link>
          {onToggleCollapse ? <Button variant="ghost" size="icon-sm" className={cn("ml-auto", collapsed && "ml-0")} onClick={onToggleCollapse} aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button> : null}
        </div>
        <nav className="flex-1 p-2.5" aria-label="主导航">
          <p className={cn("px-3 py-2 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/45", collapsed && "sr-only")}>工作区</p>
          {collapsed ? <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">项目</TooltipContent></Tooltip> : link}
        </nav>
        <div className="border-t p-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={cn("h-auto w-full justify-start gap-2 px-2 py-2", collapsed && "justify-center px-0")}>
                <Avatar className="size-8"><AvatarFallback>{initials(viewer.user.displayName)}</AvatarFallback></Avatar>
                <span className={cn("min-w-0 flex-1 text-left", collapsed && "sr-only")}><span className="block truncate text-sm font-medium">{viewer.user.displayName}</span><span className="block truncate text-[11px] text-muted-foreground">{productRoleLabel(viewer.user.productRole)} · {viewer.user.email}</span></span>
                {!collapsed ? <ChevronRight className="size-3.5" /> : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-60">
              <DropdownMenuLabel>{productRoleLabel(viewer.user.productRole)}</DropdownMenuLabel>
              {admin ? <><DropdownMenuSeparator /><DropdownMenuItem asChild><Link href="/organization" onClick={onMobileClose}><Users />组织与账号</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href="/settings" onClick={onMobileClose}><Settings />系统设置</Link></DropdownMenuItem></> : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={loggingOut} onSelect={() => void logout()}><LogOut />{loggingOut ? "正在退出" : "退出登录"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}
