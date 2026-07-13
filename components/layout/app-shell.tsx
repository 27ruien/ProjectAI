"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { EnvironmentBanner } from "./environment-banner";
import { ToastProvider } from "@/components/common/toast";
import { FeedbackDrawer } from "@/components/feedback";
import { cn } from "@/lib/utils";
import { storageKey } from "@/lib/storage-key";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem(storageKey("sidebar")) === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const changeCollapsed = (value: boolean) => { setCollapsed(value); window.localStorage.setItem(storageKey("sidebar"), value ? "collapsed" : "expanded"); };
  return <ToastProvider><div className="min-h-screen bg-background"><Sidebar collapsed={collapsed} onCollapsedChange={changeCollapsed} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} /><div className={cn("min-h-screen transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[232px]")}><EnvironmentBanner /><Topbar onMenuOpen={() => setMobileOpen(true)} onFeedbackOpen={() => setFeedbackOpen(true)} /><main className="min-h-[calc(100vh-64px)]"><div className="mx-auto w-full max-w-[1540px] page-enter">{children}</div></main></div><FeedbackDrawer open={feedbackOpen} onClose={() => setFeedbackOpen(false)} /></div></ToastProvider>;
}
