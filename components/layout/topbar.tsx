"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronDown, Command, FileText, FolderKanban, Menu, Search, Sparkles, X } from "lucide-react";
import { useToast } from "@/components/common/toast";

const labels: Record<string, string> = {
  dashboard: "工作台", projects: "项目", new: "创建项目", overview: "项目概览", documents: "项目资料",
  knowledge: "项目知识", requirements: "需求中心", scope: "Scope 管理", actions: "Action Plan", meetings: "会议与决策",
  risks: "风险与状态", workflows: "AI 工作流", "requirement-extraction": "需求提取", reviews: "审核中心", skills: "Skills",
  analytics: "数据看板", settings: "系统设置", "ai-models": "AI 模型管理",
};

export function Topbar({ onMenuOpen }: { onMenuOpen: () => void }) {
  const pathname = usePathname();
  const { toast } = useToast();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.filter((item, index) => !(segments[0] === "projects" && index === 1)).map((item) => labels[item] ?? (item.startsWith("proj-") ? "项目详情" : item));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key === "Escape") setSearchOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  const searchItems = useMemo(() => [
    { label: "北美旗舰店 AI 互动活动", detail: "项目 · 进行中", href: "/projects/proj-001/overview", icon: FolderKanban },
    { label: "品牌官网重构", detail: "项目 · 需求确认", href: "/projects/proj-002/overview", icon: FolderKanban },
    { label: "REQ-018 会员权益配置", detail: "需求 · P1", href: "/projects/proj-003/requirements", icon: FileText },
    { label: "AI 提取需求", detail: "工作流", href: "/workflows/requirement-extraction", icon: Sparkles },
  ].filter((item) => `${item.label}${item.detail}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return <><header className="sticky top-0 z-30 flex h-16 items-center border-b bg-card/95 px-4 backdrop-blur sm:px-6">
    <button className="mr-3 rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden" onClick={onMenuOpen} aria-label="打开导航"><Menu className="size-5" /></button>
    <nav className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground" aria-label="面包屑"><Link href="/dashboard" className="hidden hover:text-foreground sm:inline">Project AI OS</Link>{crumbs.map((crumb, index) => <span key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-1"><span className="hidden text-border sm:inline">/</span><span className={index === crumbs.length - 1 ? "truncate font-medium text-foreground" : "hidden truncate sm:inline"}>{crumb}</span></span>)}</nav>
    <div className="ml-auto flex items-center gap-1.5">
      <button onClick={() => setSearchOpen(true)} className="hidden h-8 w-56 items-center gap-2 rounded-lg border bg-surface px-2.5 text-left text-xs text-muted-foreground transition-colors hover:border-input sm:flex" aria-label="全局搜索"><Search className="size-3.5" /><span className="flex-1">搜索项目、需求或资料</span><span className="inline-flex items-center gap-0.5 rounded border bg-card px-1 py-0.5 font-mono text-[9px]"><Command className="size-2.5" />K</span></button>
      <button onClick={() => setSearchOpen(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden" aria-label="全局搜索"><Search className="size-[18px]" /></button>
      <button onClick={() => toast("你有 3 条待审核提醒和 1 条风险预警", "info")} className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="通知"><Bell className="size-[18px]" /><span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-destructive ring-2 ring-white" /></button>
      <button onClick={() => toast("账户与团队设置将在后续阶段开放", "info")} className="ml-1 flex items-center gap-2 rounded-lg p-1 hover:bg-muted" aria-label="账户菜单"><span className="grid size-7 place-items-center rounded-full bg-primary/12 text-xs font-semibold text-primary">林</span><span className="hidden text-left lg:block"><span className="block text-xs font-medium leading-3.5">林知行</span><span className="block text-[10px] text-muted-foreground">项目经理</span></span><ChevronDown className="hidden size-3 text-muted-foreground lg:block" /></button>
    </div>
  </header>{searchOpen ? <div className="fixed inset-0 z-[75] flex items-start justify-center bg-[var(--overlay)] px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="全局搜索"><button className="absolute inset-0" onClick={() => setSearchOpen(false)} aria-label="关闭搜索" /><section className="relative w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-float)]"><div className="flex items-center gap-3 border-b px-4"><Search className="size-4 text-muted-foreground" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、需求、资料或工作流" className="h-13 min-w-0 flex-1 bg-transparent text-sm outline-none" /><button onClick={() => setSearchOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="关闭"><X className="size-4" /></button></div><div className="max-h-80 overflow-y-auto p-2">{searchItems.length ? searchItems.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} onClick={() => setSearchOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted"><span className="grid size-8 place-items-center rounded-lg bg-primary/8 text-primary"><Icon className="size-4" /></span><span className="min-w-0"><strong className="block truncate text-xs font-medium">{item.label}</strong><small className="text-[11px] text-muted-foreground">{item.detail}</small></span></Link>; }) : <p className="px-3 py-10 text-center text-sm text-muted-foreground">未找到匹配内容</p>}</div><footer className="flex items-center justify-between border-t bg-surface px-4 py-2 text-[10px] text-muted-foreground"><span>仅搜索当前权限范围内的数据</span><span>ESC 关闭</span></footer></section></div> : null}</>;
}
