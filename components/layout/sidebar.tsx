"use client";

import Link from "next/link";
import {
  BarChart3,
  Blocks,
  Bot,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  LayoutDashboard,
  Library,
  Settings,
  ShieldCheck,
  Workflow,
  Clock3,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { systemRoleLabel, type ViewerContext } from "@/lib/auth/ui-types";

const navigation = [
  { label: "工作台", href: "/dashboard", icon: LayoutDashboard },
  { label: "项目", href: "/projects", icon: FolderKanban },
  { label: "工作日报", href: "/daily-report", icon: Clock3, feature: "pmDailyReport" },
  { label: "AI 工作流", href: "/workflows", icon: Workflow },
  { label: "审核中心", href: "/reviews", icon: ShieldCheck, badge: "8" },
  { label: "Skills", href: "/skills", icon: Blocks },
  { label: "知识与资产", href: "/knowledge", icon: Library },
  { label: "数据看板", href: "/analytics", icon: BarChart3 },
];

interface SidebarProps {
  viewer: ViewerContext;
  currentPath: string;
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  featureFlags: { pmDailyReport: boolean; wecomTimesheetSync: boolean };
}

export function Sidebar({ viewer, currentPath, collapsed, onCollapsedChange, mobileOpen, onMobileClose, featureFlags }: SidebarProps) {
  const active = (href: string) => currentPath === href || (href !== "/dashboard" && currentPath.startsWith(`${href}/`));
  const canUseWriteWorkflows = viewer.projects.some((project) => project.permissions.canEditProject);
  const visibleNavigation = navigation.filter((item) => {
    if (item.feature === "pmDailyReport" && !featureFlags.pmDailyReport) return false;
    return canUseWriteWorkflows || !["/workflows", "/reviews"].includes(item.href);
  });
  return <>
    {mobileOpen ? <button className="fixed inset-0 z-40 bg-[var(--overlay)] lg:hidden" aria-label="关闭导航" onClick={onMobileClose} /> : null}
    <aside className={cn("fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 lg:translate-x-0", collapsed ? "w-[72px]" : "w-[232px]", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
      <div className={cn("flex h-16 items-center border-b border-white/8", collapsed ? "justify-center px-3" : "px-4")}>
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5" onClick={onMobileClose}>
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-primary text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/16%)]"><Bot className="size-[18px]" /></span>
          {!collapsed ? <span className="truncate text-[15px] font-semibold tracking-[-0.02em]">Project AI OS</span> : null}
        </Link>
        <button className="ml-auto rounded-md p-1.5 text-sidebar-muted hover:bg-white/8 hover:text-white lg:hidden" aria-label="关闭导航" onClick={onMobileClose}><X className="size-4" /></button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-4" aria-label="主导航">
        <p className={cn("mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted", collapsed && "sr-only")}>Workspace</p>
        <div className="space-y-1">{visibleNavigation.map((item) => {
          const Icon = item.icon;
          const selected = active(item.href);
          return <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined} onClick={onMobileClose} className={cn("group flex h-10 items-center gap-3 rounded-lg text-[13px] font-medium transition-colors", collapsed ? "justify-center px-0" : "px-2.5", selected ? "bg-sidebar-accent text-white" : "text-sidebar-muted hover:bg-white/6 hover:text-white")}>
            <Icon className={cn("size-[17px] shrink-0", selected && "text-[#a9a2ff]")} />
            {!collapsed ? <><span className="flex-1">{item.label}</span>{item.badge ? <span className="rounded-full bg-primary/35 px-1.5 py-0.5 text-[10px] text-[#d9d5ff]">{item.badge}</span> : null}</> : null}
          </Link>;
        })}</div>

        <div className="my-4 border-t border-white/8" />
        {viewer.user.systemRole === "system_admin" ? <Link href="/settings" title={collapsed ? "系统设置" : undefined} onClick={onMobileClose} className={cn("flex h-10 items-center gap-3 rounded-lg text-[13px] font-medium transition-colors", collapsed ? "justify-center" : "px-2.5", active("/settings") ? "bg-sidebar-accent text-white" : "text-sidebar-muted hover:bg-white/6 hover:text-white")}><Settings className="size-[17px]" />{!collapsed ? <span>系统设置</span> : null}</Link> : null}
      </nav>

      <div className="border-t border-white/8 p-2.5">
        {!collapsed ? <div className="mb-2 rounded-lg bg-white/[0.04] p-3"><div className="flex items-center gap-2 text-xs text-sidebar-foreground"><span className="size-1.5 rounded-full bg-emerald-400" />{systemRoleLabel(viewer.user.systemRole)}</div><p className="mt-1 text-[10px] text-sidebar-muted">{canUseWriteWorkflows ? "当前业务内容仍为 Mock" : "已启用项目只读模式"}</p></div> : null}
        <button onClick={() => onCollapsedChange(!collapsed)} className="hidden h-9 w-full items-center justify-center rounded-lg text-sidebar-muted hover:bg-white/6 hover:text-white lg:flex" aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}>{collapsed ? <ChevronRight className="size-4" /> : <><ChevronLeft className="size-4" /><span className="ml-2 text-xs">收起导航</span></>}</button>
      </div>
    </aside>
  </>;
}
