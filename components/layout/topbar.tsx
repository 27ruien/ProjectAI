"use client";

import Link from "next/link";
import { ActionIcon, Breadcrumbs, Group, Text } from "@mantine/core";
import { Menu } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { EnvironmentBadge } from "./environment-banner";

const labels: Record<string, string> = {
  assistant: "AI 助手",
  "data-spaces": "资料空间",
  projects: "项目资料",
  company: "公司资料",
  new: "创建项目",
  overview: "基本信息",
  files: "项目文件",
  documents: "文件",
  versions: "版本",
  view: "查看",
  members: "成员与权限",
  settings: "管理设置",
  organization: "组织与账号",
  admin: "管理后台",
  models: "Provider 与模型",
};

function safeLabel(segment: string, index: number, segments: string[], project?: AuthorizedProjectSummary) {
  if (project && segments[0] === "data-spaces" && segments[1] === "projects" && index === 2) return project.name;
  if (labels[segment]) return labels[segment];
  if (/^(project|document|version)-/iu.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment)) return "详情";
  return segment;
}

export function Topbar({
  currentProject,
  currentPath,
  onMenuOpen,
}: {
  currentProject?: AuthorizedProjectSummary;
  currentPath: string;
  onMenuOpen: () => void;
}) {
  const segments = currentPath.split("/").filter(Boolean);
  const items = segments.map((item, index) => safeLabel(item, index, segments, currentProject));
  return (
    <Group h="100%" px={{ base: "md", sm: "lg", lg: "xl" }} wrap="nowrap">
      <ActionIcon variant="subtle" hiddenFrom="lg" onClick={onMenuOpen} aria-label="打开导航"><Menu size={19} /></ActionIcon>
      <Breadcrumbs fz="xs" style={{ minWidth: 0 }}>
        <Text component={Link} href="/assistant" c="dimmed" visibleFrom="sm">ProjectAI</Text>
        {items.map((item, index) => <Text key={`${item}-${index}`} truncate fw={index === items.length - 1 ? 600 : 400} c={index === items.length - 1 ? "dark" : "dimmed"}>{item}</Text>)}
      </Breadcrumbs>
      <Group ml="auto"><EnvironmentBadge /></Group>
    </Group>
  );
}
