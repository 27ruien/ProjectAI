"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bot,
  Building2,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
  FolderOpen,
  LogOut,
  Settings,
  ShieldCheck,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const navigation = [
  { label: "AI 助手", href: "/assistant", icon: Bot },
  { label: "资料空间", href: "/data-spaces", icon: FolderOpen },
] as const;

interface SidebarProps {
  viewer: ViewerContext;
  currentPath: string;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onMobileClose: () => void;
}

function NavigationLink({ href, label, icon: Icon, active, nested, collapsed, onClick }: {
  href: string;
  label: string;
  icon: typeof Bot;
  active: boolean;
  nested?: boolean;
  collapsed?: boolean;
  onClick: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        nested && !collapsed && "ml-5 h-8 text-xs",
        collapsed && "justify-center px-0",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>{label}</span>
      {href === "/data-spaces" && !collapsed ? <ChevronRight aria-hidden className="size-3.5" /> : null}
    </Link>
  );
  return collapsed ? <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{label}</TooltipContent></Tooltip> : link;
}

export function Sidebar({ viewer, currentPath, collapsed, onToggleCollapse, onMobileClose }: SidebarProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const active = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);
  const admin = viewer.user.systemRole === "system_admin" || viewer.user.productRole === "admin";
  const canManageAiModels = viewer.user.systemRole === "system_admin" || Boolean(viewer.aiConfigurationOrganizationId);
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
    <TooltipProvider delayDuration={150}><div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn("flex h-14 shrink-0 items-center gap-2 border-b px-4", collapsed && "justify-center px-2")}>
        <span className="grid size-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <Building2 aria-hidden className="size-4" />
        </span>
        <Link href="/assistant" onClick={onMobileClose} className={cn("font-semibold tracking-tight", collapsed && "sr-only")}>ProjectAI</Link>
        {onToggleCollapse ? <Button variant="ghost" size="icon-sm" className={cn("ml-auto", collapsed && "ml-0")} onClick={onToggleCollapse} aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button> : null}
      </div>

      <ScrollArea className="min-h-0 flex-1 p-3">
        <p className={cn("px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45", collapsed && "sr-only")}>工作区</p>
        <nav className="grid gap-1" aria-label="主导航">
          {navigation.map((item) => (
            <NavigationLink key={item.href} {...item} active={active(item.href)} collapsed={collapsed} onClick={onMobileClose} />
          ))}
          {active("/data-spaces") ? (
            <div className={cn("grid gap-1", !collapsed && "border-l pl-1")}>
              <NavigationLink href="/data-spaces/projects" label="项目资料" icon={FolderOpen} active={active("/data-spaces/projects")} nested collapsed={collapsed} onClick={onMobileClose} />
              <NavigationLink href="/data-spaces/company" label="公司资料" icon={FileText} active={active("/data-spaces/company")} nested collapsed={collapsed} onClick={onMobileClose} />
            </div>
          ) : null}
        </nav>
      </ScrollArea>

      <div className="border-t p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className={cn("h-auto w-full justify-start gap-2 px-2 py-2", collapsed && "justify-center px-0")} aria-label="账户菜单">
              <Avatar className="size-8"><AvatarFallback>{initials(viewer.user.displayName)}</AvatarFallback></Avatar>
              <span className={cn("min-w-0 flex-1 text-left", collapsed && "sr-only")}>
                <span className="block truncate text-sm font-medium">{viewer.user.displayName}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{productRoleLabel(viewer.user.productRole)}</span>
              </span>
              {!collapsed ? <ChevronRight aria-hidden className="size-3.5" /> : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuLabel className="flex items-center gap-2"><ShieldCheck className="size-4" />{productRoleLabel(viewer.user.productRole)}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {admin ? <>
              <DropdownMenuItem asChild><Link href="/organization" onClick={onMobileClose}><Users />组织与账号</Link></DropdownMenuItem>
              <DropdownMenuItem asChild><Link href="/settings" onClick={onMobileClose}><Settings />管理设置</Link></DropdownMenuItem>
            </> : null}
            {canManageAiModels ? <DropdownMenuItem asChild><Link href="/admin/models" onClick={onMobileClose}><Bot />Provider 与模型</Link></DropdownMenuItem> : null}
            <DropdownMenuItem asChild><Link href="/help/models-and-api" onClick={onMobileClose}><FileText />模型与 API 帮助</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={loggingOut} onSelect={() => void logout()}><LogOut />{loggingOut ? "正在退出" : "退出登录"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div></TooltipProvider>
  );
}
