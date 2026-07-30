"use client";

import Link from "next/link";
import { Bot, Building2, ChevronLeft, ChevronRight, FolderKanban, Library, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ViewerContext } from "@/lib/auth/ui-types";

const navigation = [
  { label: "项目", href: "/projects", icon: FolderKanban },
  { label: "AI 对话", href: "/chat", icon: Bot },
  { label: "公司知识库", href: "/company-knowledge", icon: Library },
] as const;

interface SidebarProps {
  viewer: ViewerContext;
  currentPath: string;
  collapsed: boolean;
  onCollapsedChange: (value: boolean) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  featureFlags: { pmDailyReport: boolean; wecomTimesheetSync: boolean };
}

export function Sidebar({ currentPath, collapsed, onCollapsedChange, mobileOpen, onMobileClose }: SidebarProps) {
  const active = (href: string) => currentPath === href || currentPath.startsWith(`${href}/`);
  return <>
    {mobileOpen ? <button className="fixed inset-0 z-40 bg-[var(--overlay)] lg:hidden" aria-label="关闭导航" onClick={onMobileClose} /> : null}
    <aside className={cn("fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 lg:translate-x-0", collapsed ? "w-[72px]" : "w-[232px]", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
      <div className={cn("flex h-16 items-center border-b border-white/8", collapsed ? "justify-center px-3" : "px-4")}>
        <Link href="/projects" className="flex min-w-0 items-center gap-2.5" onClick={onMobileClose}>
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-primary text-white"><Building2 className="size-[18px]" /></span>
          {!collapsed ? <span className="truncate text-[15px] font-semibold">ProjectAI</span> : null}
        </Link>
        <button className="ml-auto rounded-md p-1.5 text-sidebar-muted hover:bg-white/8 hover:text-white lg:hidden" aria-label="关闭导航" onClick={onMobileClose}><X className="size-4" /></button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-4" aria-label="主导航">
        <p className={cn("mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted", collapsed && "sr-only")}>内部 MVP</p>
        <div className="space-y-1">{navigation.map((item) => {
          const Icon = item.icon;
          const selected = active(item.href);
          return <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined} onClick={onMobileClose} className={cn("flex h-10 items-center gap-3 rounded-lg text-[13px] font-medium transition-colors", collapsed ? "justify-center" : "px-2.5", selected ? "bg-sidebar-accent text-white" : "text-sidebar-muted hover:bg-white/6 hover:text-white")}>
            <Icon className={cn("size-[17px] shrink-0", selected && "text-[#a9a2ff]")} />
            {!collapsed ? <span>{item.label}</span> : null}
          </Link>;
        })}</div>
      </nav>
      <div className="p-2.5"><button onClick={() => onCollapsedChange(!collapsed)} className="hidden h-9 w-full items-center justify-center rounded-lg text-sidebar-muted hover:bg-white/6 hover:text-white lg:flex" aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}>{collapsed ? <ChevronRight className="size-4" /> : <><ChevronLeft className="size-4" /><span className="ml-2 text-xs">收起导航</span></>}</button></div>
    </aside>
  </>;
}
