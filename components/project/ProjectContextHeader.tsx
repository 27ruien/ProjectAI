"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Badge, Box, Breadcrumbs, Group, Tabs, Text, Title } from "@/components/ui/project-primitives";
import { Eye } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { statusLabel } from "./mock-view";

export type ProjectTab = "overview" | "files" | "artifacts" | "members";

const tabs: { id: Exclude<ProjectTab, "artifacts">; label: string; path: string }[] = [
  { id: "overview", label: "基本信息", path: "overview" },
  { id: "files", label: "项目资料", path: "files" },
  { id: "members", label: "成员与权限", path: "members" },
];

function statusColor(status: string) {
  if (["active", "in_progress"].includes(status)) return "green";
  if (["blocked", "at_risk"].includes(status)) return "orange";
  return "gray";
}

export function ProjectContextHeader({
  project,
  activeTab,
  actions,
}: {
  project: AuthorizedProjectSummary;
  activeTab: ProjectTab;
  actions?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${project.name} · Project AI OS`;
  }, [project.name]);

  const selected = activeTab === "artifacts" ? "files" : activeTab;
  return (
    <Box bg="white" bd="0 0 1px 0 solid var(--border)">
      <Box px={{ base: "md", sm: "lg", lg: "xl" }} pt="lg">
        <Breadcrumbs fz="xs" mb="sm">
          <Text component={Link} href="/data-spaces/projects" c="dimmed">项目资料</Text>
          <Text>{project.name}</Text>
        </Breadcrumbs>
        <Group justify="space-between" align="flex-start" gap="lg">
          <Box miw={0}>
            <Group gap="sm">
              <Title order={1} size="h2" lineClamp={1}>{project.name}</Title>
              <Badge variant="light" color={statusColor(project.status)}>{statusLabel(project.status)}</Badge>
              {!project.permissions.canEditProject ? <Badge variant="light" leftSection={<Eye size={12} />}>只读</Badge> : null}
            </Group>
            <Text c="dimmed" size="sm" mt={6} maw={760}>{project.description || "暂无项目描述"}</Text>
          </Box>
          {actions ? <Group gap="xs">{actions}</Group> : null}
        </Group>
        <Tabs value={selected} mt="lg" variant="outline">
          <Tabs.List>
            {tabs.map((tab) => (
              <Tabs.Tab
                key={tab.id}
                value={tab.id}
                component={Link}
                href={tab.id === "overview" ? `/data-spaces/projects/${project.id}` : `/data-spaces/projects/${project.id}/${tab.path}`}
                data-testid={tab.id === "files" ? "project-documents-tab" : undefined}
              >{tab.label}</Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </Box>
    </Box>
  );
}
