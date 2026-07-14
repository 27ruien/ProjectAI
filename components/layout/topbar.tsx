"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  Command,
  FolderKanban,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquarePlus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useToast } from "@/components/common/toast";
import { useClientSnapshotReady } from "@/lib/browser-snapshot";
import { initials } from "@/components/project/mock-view";
import { navigateToLogin, signOut } from "@/components/auth/auth-client";
import {
  projectRoleLabel,
  systemRoleLabel,
  type AuthorizedProjectSummary,
  type ViewerContext,
} from "@/lib/auth/ui-types";
import { EnvironmentBadge } from "./environment-banner";

const labels: Record<string, string> = {
  dashboard: "工作台",
  projects: "项目",
  new: "创建项目",
  overview: "项目概览",
  documents: "项目资料",
  knowledge: "项目知识",
  requirements: "需求中心",
  scope: "Scope 管理",
  actions: "Action Plan",
  meetings: "会议与决策",
  risks: "风险与状态",
  workflows: "AI 工作流",
  "requirement-extraction": "需求提取",
  reviews: "审核中心",
  skills: "Skills",
  analytics: "数据看板",
  settings: "系统设置",
  "ai-models": "AI 模型管理",
};

interface TopbarProps {
  viewer: ViewerContext;
  currentProject?: AuthorizedProjectSummary;
  currentPath: string;
  onMenuOpen: () => void;
  onFeedbackOpen: () => void;
}

export function Topbar({ viewer, currentProject, currentPath, onMenuOpen, onFeedbackOpen }: TopbarProps) {
  const { toast } = useToast();
  const accountRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [query, setQuery] = useState("");
  const clientReady = useClientSnapshotReady();
  const segments = currentPath.split("/").filter(Boolean);
  const crumbs = segments
    .filter((item, index) => !(segments[0] === "projects" && index === 1))
    .map((item) => labels[item] ?? item);

  if (segments[0] === "projects" && segments[1] && segments[1] !== "new" && currentProject) {
    crumbs.splice(1, 0, currentProject.name);
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setAccountOpen(false);
      }
    };
    const closeAccount = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener("keydown", handler);
    document.addEventListener("mousedown", closeAccount);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("mousedown", closeAccount);
    };
  }, []);

  const searchItems = useMemo(() => {
    const projectItems = viewer.projects.map((project) => ({
      label: project.name,
      detail: `项目 · ${project.clientName}`,
      href: `/projects/${project.id}/overview`,
      icon: FolderKanban,
    }));
    const workflowItems = viewer.projects.some((project) => project.permissions.canEditProject)
      ? [{ label: "AI 提取需求", detail: "工作流 · 业务内容仍为 Mock", href: "/workflows/requirement-extraction", icon: Sparkles }]
      : [];
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return [...projectItems, ...workflowItems].filter((item) =>
      `${item.label}${item.detail}`.toLocaleLowerCase("zh-CN").includes(keyword),
    );
  }, [query, viewer.projects]);

  const accountRole = currentProject
    ? projectRoleLabel(currentProject.projectRole)
    : systemRoleLabel(viewer.user.systemRole);

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
      navigateToLogin();
    } catch {
      setLoggingOut(false);
      toast("退出失败，请稍后重试", "info");
    }
  };

  return (
    <>
      <header data-client-ready={clientReady ? "true" : "false"} className="sticky top-0 z-30 flex h-16 items-center border-b bg-card/95 px-4 backdrop-blur sm:px-6">
        <button disabled={!clientReady} className="mr-3 rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60 lg:hidden" onClick={onMenuOpen} aria-label="打开导航">
          <Menu className="size-5" />
        </button>
        <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" aria-label="面包屑">
          <Link href="/dashboard" className="hidden hover:text-foreground sm:inline">Project AI OS</Link>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1">
              <span className="hidden text-border sm:inline">/</span>
              <span className={index === crumbs.length - 1 ? "truncate font-medium text-foreground" : "hidden truncate sm:inline"}>{crumb}</span>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <EnvironmentBadge />
          <button disabled={!clientReady} onClick={() => setSearchOpen(true)} className="hidden h-8 w-56 items-center gap-2 rounded-lg border bg-surface px-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-input disabled:cursor-wait disabled:opacity-60 sm:flex" aria-label="全局搜索">
            <Search className="size-3.5" /><span className="flex-1">搜索已授权项目</span><span className="inline-flex items-center gap-0.5 rounded border bg-card px-1 py-0.5 font-mono text-[9px]"><Command className="size-2.5" />K</span>
          </button>
          <button disabled={!clientReady} onClick={() => setSearchOpen(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60 sm:hidden" aria-label="全局搜索"><Search className="size-[18px]" /></button>
          <button disabled={!clientReady} onClick={onFeedbackOpen} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground hover:border-primary/30 hover:text-primary disabled:cursor-wait disabled:opacity-60" aria-label="提交试用反馈">
            <MessageSquarePlus className="size-3.5" /><span className="hidden xl:inline">反馈</span>
          </button>
          <button disabled={!clientReady} onClick={() => toast("当前没有新的系统通知", "info")} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-60" aria-label="通知">
            <Bell className="size-[18px]" />
          </button>

          <div ref={accountRef} className="relative ml-1">
            <button
              type="button"
              disabled={!clientReady}
              onClick={() => setAccountOpen((value) => !value)}
              className="flex items-center gap-2 rounded-lg p-1 hover:bg-muted disabled:cursor-wait disabled:opacity-60"
              aria-label="账户菜单"
              aria-expanded={accountOpen}
              aria-haspopup="menu"
            >
              <span className="grid size-7 place-items-center rounded-full bg-primary/12 text-[10px] font-semibold text-primary">{initials(viewer.user.displayName)}</span>
              <span className="hidden text-left lg:block">
                <span className="block max-w-32 truncate text-xs font-medium leading-3.5">{viewer.user.displayName}</span>
                <span className="block text-[10px] text-muted-foreground">{accountRole}</span>
              </span>
              <ChevronDown className={`hidden size-3 text-muted-foreground transition-transform lg:block ${accountOpen ? "rotate-180" : ""}`} />
            </button>
            {accountOpen ? (
              <div role="menu" className="absolute right-0 top-11 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-float)]">
                <div className="border-b border-border px-4 py-3">
                  <p className="truncate text-sm font-medium text-foreground">{viewer.user.displayName}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{viewer.user.email}</p>
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-primary/15 bg-primary/8 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <ShieldCheck className="size-3" />{accountRole}
                  </span>
                </div>
                <button role="menuitem" type="button" onClick={logout} disabled={loggingOut} className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60">
                  {loggingOut ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : <LogOut className="size-4 text-muted-foreground" />}
                  {loggingOut ? "正在退出" : "退出登录"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {searchOpen ? (
        <div className="fixed inset-0 z-[75] flex items-start justify-center bg-[var(--overlay)] px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="全局搜索">
          <button className="absolute inset-0" onClick={() => setSearchOpen(false)} aria-label="关闭搜索" />
          <section className="relative w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-float)]">
            <div className="flex items-center gap-3 border-b px-4">
              <Search className="size-4 text-muted-foreground" />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已授权项目" className="h-13 min-w-0 flex-1 bg-transparent text-sm outline-none" />
              <button onClick={() => setSearchOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="关闭"><X className="size-4" /></button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {searchItems.length ? searchItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => setSearchOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted">
                    <span className="grid size-8 place-items-center rounded-lg bg-primary/8 text-primary"><Icon className="size-4" /></span>
                    <span className="min-w-0"><strong className="block truncate text-xs font-medium">{item.label}</strong><small className="text-[11px] text-muted-foreground">{item.detail}</small></span>
                  </Link>
                );
              }) : <p className="px-3 py-10 text-center text-sm text-muted-foreground">未找到已授权范围内的匹配内容</p>}
            </div>
            <footer className="flex items-center justify-between border-t bg-surface px-4 py-2 text-[10px] text-muted-foreground"><span>仅搜索服务端授权范围内的数据</span><span>ESC 关闭</span></footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
