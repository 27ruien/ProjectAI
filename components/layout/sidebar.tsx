"use client";

import Link from "next/link";
import { Bot, Building2, FolderOpen, LogOut, Settings, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { initials } from "@/components/project/mock-view";
import { navigateToLogin, signOut } from "@/components/auth/auth-client";
import { productRoleLabel, type ViewerContext } from "@/lib/auth/ui-types";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const navigation = [
  { label: "AI 助手", href: "/assistant", icon: Bot },
  { label: "资料空间", href: "/data-spaces", icon: FolderOpen },
] as const;

interface SidebarProps {
  viewer: ViewerContext;
  currentPath: string;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function SidebarContent({ viewer, currentPath, onNavigate }: { viewer: ViewerContext; currentPath: string; onNavigate?: () => void }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const active = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);
  const admin = viewer.user.productRole === "super_admin" || viewer.user.productRole === "admin";
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await signOut(); navigateToLogin(); } finally { setLoggingOut(false); }
  };
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex h-[58px] items-center border-b border-sidebar-border px-4">
      <Link href="/assistant" className="flex min-w-0 items-center gap-2.5" onClick={onNavigate}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/15 bg-accent text-primary"><Building2 className="size-[17px]" /></span>
        <span className="truncate text-[15px] font-semibold tracking-tight">ProjectAI</span>
      </Link>
    </div>
    <nav className="flex-1 overflow-y-auto p-3" aria-label="主导航">
      <p className="mb-2 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-sidebar-muted">工作区</p>
      <div className="space-y-1">{navigation.map((item) => {
        const Icon = item.icon;
        return <Link key={item.href} href={item.href} onClick={onNavigate} className={cn("flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors", active(item.href) ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-muted hover:bg-muted hover:text-sidebar-foreground")}>
          <Icon className="size-[17px] shrink-0" /><span>{item.label}</span>
        </Link>;
      })}</div>
    </nav>
    <div className="border-t border-sidebar-border p-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted" aria-label="账户菜单">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-primary">{initials(viewer.user.displayName)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{viewer.user.displayName}</span><span className="block truncate text-[10px] text-muted-foreground">{productRoleLabel(viewer.user.productRole)}</span></span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="flex items-center gap-2 text-xs"><ShieldCheck className="size-3.5 text-primary" />{productRoleLabel(viewer.user.productRole)}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {admin ? <>
            <DropdownMenuItem asChild><Link href="/organization" onClick={onNavigate}><Users />组织与账号</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/settings" onClick={onNavigate}><Settings />管理设置</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
          </> : null}
          <DropdownMenuItem onSelect={() => void logout()} disabled={loggingOut}><LogOut />{loggingOut ? "正在退出" : "退出登录"}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>;
}

export function Sidebar({ viewer, currentPath, mobileOpen, onMobileClose }: SidebarProps) {
  return <>
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:block">
      <SidebarContent viewer={viewer} currentPath={currentPath} />
    </aside>
    <Sheet open={mobileOpen} onOpenChange={(open) => { if (!open) onMobileClose(); }}>
      <SheetContent side="left" className="w-[min(86vw,280px)] border-sidebar-border bg-sidebar p-0" showCloseButton>
        <SheetHeader className="sr-only"><SheetTitle>主导航</SheetTitle><SheetDescription>ProjectAI 移动端导航</SheetDescription></SheetHeader>
        <SidebarContent viewer={viewer} currentPath={currentPath} onNavigate={onMobileClose} />
      </SheetContent>
    </Sheet>
  </>;
}
