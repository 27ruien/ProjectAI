"use client";

import Link from "next/link";
import { ChevronDown, LoaderCircle, LogOut, Menu, Settings, ShieldCheck, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { initials } from "@/components/project/mock-view";
import { navigateToLogin, signOut } from "@/components/auth/auth-client";
import { productRoleLabel, type AuthorizedProjectSummary, type ViewerContext } from "@/lib/auth/ui-types";
import { EnvironmentBadge } from "./environment-banner";

const labels: Record<string, string> = {
  projects: "项目",
  new: "创建项目",
  overview: "概览",
  files: "项目资料",
  requirements: "需求文档",
  members: "成员与权限",
  chat: "AI 对话",
  "company-knowledge": "公司知识库",
  settings: "系统设置",
  organization: "组织与账号",
};

interface TopbarProps {
  viewer: ViewerContext;
  currentProject?: AuthorizedProjectSummary;
  currentPath: string;
  onMenuOpen: () => void;
  onFeedbackOpen: () => void;
}

export function Topbar({ viewer, currentProject, currentPath, onMenuOpen }: TopbarProps) {
  const accountRef = useRef<HTMLDivElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const segments = currentPath.split("/").filter(Boolean);
  const crumbs = segments.filter((_, index) => !(segments[0] === "projects" && index === 1)).map((item) => labels[item] ?? item);
  if (segments[0] === "projects" && segments[1] && segments[1] !== "new" && currentProject) crumbs.splice(1, 0, currentProject.name);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await signOut(); navigateToLogin(); } finally { setLoggingOut(false); }
  };
  const admin = viewer.user.productRole === "super_admin" || viewer.user.productRole === "admin";
  return <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-card/95 px-4 backdrop-blur sm:px-6">
    <button className="mr-3 rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden" onClick={onMenuOpen} aria-label="打开导航"><Menu className="size-5" /></button>
    <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" aria-label="面包屑">
      <Link href="/projects" className="hidden hover:text-foreground sm:inline">ProjectAI</Link>
      {crumbs.map((crumb, index) => <span key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1"><span className="hidden text-border sm:inline">/</span><span className={index === crumbs.length - 1 ? "truncate font-medium text-foreground" : "hidden truncate sm:inline"}>{crumb}</span></span>)}
    </nav>
    <div className="ml-auto flex items-center gap-2">
      <EnvironmentBadge />
      <div ref={accountRef} className="relative">
        <button type="button" onClick={() => setAccountOpen((value) => !value)} className="flex items-center gap-2 rounded-lg p-1 hover:bg-muted" aria-label="账户菜单" aria-expanded={accountOpen}>
          <span className="grid size-8 place-items-center rounded-full bg-primary/12 text-[10px] font-semibold text-primary">{initials(viewer.user.displayName)}</span>
          <span className="hidden text-left lg:block"><span className="block max-w-32 truncate text-xs font-medium">{viewer.user.displayName}</span><span className="block text-[10px] text-muted-foreground">{productRoleLabel(viewer.user.productRole)}</span></span>
          <ChevronDown className={`hidden size-3 text-muted-foreground transition-transform lg:block ${accountOpen ? "rotate-180" : ""}`} />
        </button>
        {accountOpen ? <div role="menu" className="absolute right-0 top-11 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-float)]">
          <div className="border-b border-border px-4 py-3"><p className="truncate text-sm font-medium">{viewer.user.displayName}</p><span className="mt-2 inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary"><ShieldCheck className="size-3" />{productRoleLabel(viewer.user.productRole)}</span></div>
          {admin ? <><Link role="menuitem" href="/organization" onClick={() => setAccountOpen(false)} className="flex items-center gap-2 px-4 py-3 text-xs font-medium hover:bg-muted"><Users className="size-4 text-muted-foreground" />组织与账号</Link><Link role="menuitem" href="/settings" onClick={() => setAccountOpen(false)} className="flex items-center gap-2 px-4 py-3 text-xs font-medium hover:bg-muted"><Settings className="size-4 text-muted-foreground" />系统设置</Link></> : null}
          <button role="menuitem" type="button" onClick={logout} disabled={loggingOut} className="flex w-full items-center gap-2 border-t px-4 py-3 text-left text-xs font-medium hover:bg-muted disabled:opacity-60">{loggingOut ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4 text-muted-foreground" />}{loggingOut ? "正在退出" : "退出登录"}</button>
        </div> : null}
      </div>
    </div>
  </header>;
}
