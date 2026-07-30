"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { EnvironmentBadge } from "./environment-banner";
import { Button } from "@/components/ui/button";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";

const labels: Record<string, string> = { projects: "项目", new: "创建项目", overview: "概览", files: "项目资料", requirements: "需求文档", members: "成员与权限", chat: "AI 对话", "company-knowledge": "公司知识库", settings: "管理设置", organization: "组织与账号" };

export function Topbar({ currentProject, currentPath, onMenuOpen }: { currentProject?: AuthorizedProjectSummary; currentPath: string; onMenuOpen: () => void }) {
  const segments = currentPath.split("/").filter(Boolean);
  const items = segments.filter((_, index) => !(segments[0] === "projects" && index === 1)).map((item) => labels[item] ?? item);
  if (segments[0] === "projects" && segments[1] && segments[1] !== "new" && currentProject) items.splice(1, 0, currentProject.name);
  return <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-background/95 px-4 backdrop-blur sm:px-6 lg:px-8">
    <Button variant="ghost" size="icon" className="mr-2 lg:hidden" onClick={onMenuOpen} aria-label="打开导航"><Menu /></Button>
    <Breadcrumb className="min-w-0"><BreadcrumbList className="flex-nowrap text-xs">
      <BreadcrumbItem className="hidden sm:flex"><BreadcrumbLink asChild><Link href="/projects">ProjectAI</Link></BreadcrumbLink></BreadcrumbItem>
      {items.map((item, index) => <span key={`${item}-${index}`} className="contents"><BreadcrumbSeparator className="hidden sm:block" /><BreadcrumbItem className={index === items.length - 1 ? "min-w-0" : "hidden sm:flex"}>{index === items.length - 1 ? <BreadcrumbPage className="truncate">{item}</BreadcrumbPage> : <span>{item}</span>}</BreadcrumbItem></span>)}
    </BreadcrumbList></Breadcrumb>
    <div className="ml-auto"><EnvironmentBadge /></div>
  </header>;
}
