"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { ToastProvider } from "@/components/common/toast";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("project-ai-os:sidebar") === "collapsed");
  const [mobileOpen, setMobileOpen] = useState(false);
  const changeCollapsed = (value: boolean) => { setCollapsed(value); window.localStorage.setItem("project-ai-os:sidebar", value ? "collapsed" : "expanded"); };
  return <ToastProvider><div className="min-h-screen bg-background"><Sidebar collapsed={collapsed} onCollapsedChange={changeCollapsed} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} /><div className={cn("min-h-screen transition-[padding] duration-200", collapsed ? "lg:pl-[72px]" : "lg:pl-[232px]")}><Topbar onMenuOpen={() => setMobileOpen(true)} /><main className="min-h-[calc(100vh-64px)]"><div className="mx-auto w-full max-w-[1540px] page-enter">{children}</div></main></div></div></ToastProvider>;
}
