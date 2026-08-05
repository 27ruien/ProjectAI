"use client";

import Link from "next/link";
import { Check, Menu, Monitor, Moon, Sun } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { EnvironmentBadge } from "./environment-banner";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator as MenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppearance, type Appearance } from "@/components/theme-provider";

const labels: Record<string, string> = {
  assistant: "AI 助手", "data-spaces": "资料空间", projects: "项目资料", company: "公司资料",
  new: "创建项目", overview: "基本信息", files: "项目文件", documents: "文件", versions: "版本",
  view: "查看", members: "成员与权限", settings: "管理设置", organization: "组织与账号",
  admin: "管理后台", models: "Provider 与模型", help: "帮助中心", "models-and-api": "模型与 API",
};

function safeLabel(segment: string, index: number, segments: string[], project?: AuthorizedProjectSummary) {
  if (project && segments[0] === "data-spaces" && segments[1] === "projects" && index === 2) return project.name;
  if (labels[segment]) return labels[segment];
  if (/^(project|document|version)-/iu.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment)) return "详情";
  return segment;
}

const appearanceOptions: Array<{ value: Appearance; label: string; icon: typeof Sun }> = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

export function Topbar({ currentProject, currentPath, onMenuOpen }: { currentProject?: AuthorizedProjectSummary; currentPath: string; onMenuOpen: () => void }) {
  const segments = currentPath.split("/").filter(Boolean);
  const items = segments.map((item, index) => safeLabel(item, index, segments, currentProject));
  const { appearance, resolvedAppearance, setAppearance } = useAppearance();

  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-3 sm:px-5 lg:px-6">
      <Button variant="ghost" size="icon" onClick={onMenuOpen} aria-label="打开导航" className="lg:hidden"><Menu /></Button>
      <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
        <BreadcrumbList className="flex-nowrap overflow-hidden text-xs">
          <BreadcrumbItem className="hidden sm:inline-flex"><BreadcrumbLink asChild><Link href="/assistant">ProjectAI</Link></BreadcrumbLink></BreadcrumbItem>
          {items.map((item, index) => <span key={`${item}-${index}`} className="contents">
            {(index > 0 || items.length > 0) ? <BreadcrumbSeparator className={index === 0 ? "hidden sm:inline-flex" : undefined} /> : null}
            <BreadcrumbItem className="min-w-0">
              {index === items.length - 1 ? <BreadcrumbPage className="truncate">{item}</BreadcrumbPage> : <span className="truncate text-muted-foreground">{item}</span>}
            </BreadcrumbItem>
          </span>)}
        </BreadcrumbList>
      </Breadcrumb>
      <EnvironmentBadge />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`外观：${appearance}`} title="切换外观">
            {resolvedAppearance === "dark" ? <Moon /> : <Sun />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel>外观</DropdownMenuLabel>
          <MenuSeparator />
          {appearanceOptions.map(({ value, label, icon: Icon }) => (
            <DropdownMenuItem key={value} onSelect={() => setAppearance(value)}>
              <Icon />{label}{appearance === value ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
