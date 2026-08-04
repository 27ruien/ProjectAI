"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Box, Button, Group, Menu, Modal, Select, Table, Text, TextInput, Title } from "@mantine/core";
import { FolderKanban, MoreHorizontal, Plus, Search } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { dateLabel, statusLabel } from "./mock-view";
import { CreateProjectDialog } from "./CreateProjectPage";

type Summary = { projectId: string; departmentName: string | null; fileCount: number; requirementCount: number; currentRequirementVersion: number | null; latestActivityAt: string };
type ProjectSummary = ViewerContext["projects"][number];

async function deleteErrorMessage(response: Response): Promise<string> {
  try { const body = await response.json() as { error?: { message?: string } }; return body.error?.message ?? "删除项目失败，请稍后重试"; }
  catch { return "删除项目失败，请稍后重试"; }
}

const statusColor: Record<string, string> = { planning: "gray", active: "projectBlue", completed: "green" };

export function ProjectsPage({ viewer }: { viewer: ViewerContext }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [summaries, setSummaries] = useState<Map<string, Summary>>(new Map());
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(withBasePath("/api/projects/focused-summaries"), { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ summaries: Summary[] }> : { summaries: [] })
      .then((payload) => setSummaries(new Map(payload.summaries.map((item) => [item.projectId, item])))).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return viewer.projects.filter((project) => {
      const summary = summaries.get(project.id);
      return (!keyword || `${project.name} ${project.description} ${summary?.departmentName ?? ""} ${project.managerDisplayName ?? ""}`.toLocaleLowerCase("zh-CN").includes(keyword)) && (status === "all" || project.status === status);
    });
  }, [query, status, summaries, viewer.projects]);
  const deleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${deleteTarget.id}`), { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(await deleteErrorMessage(response));
      setDeleteTarget(null); router.refresh();
    } catch (caught) { setDeleteError(caught instanceof Error ? caught.message : "删除项目失败"); }
    finally { setDeleting(false); }
  };
  return <main className="min-h-full px-5 py-7 sm:px-6 lg:px-8" data-testid="projects-page">
    <Group justify="space-between" align="flex-end" mb="xl" wrap="wrap">
      <Box><Title order={2}>项目</Title><Text size="sm" c="dimmed" mt={6}>每个项目是一组独立资料、成员权限与 AI 产物。</Text></Box>
      {viewer.canCreateProject ? <CreateProjectDialog managerName={viewer.user.displayName} trigger={<Button leftSection={<Plus size={16} />}>创建项目</Button>} /> : null}
    </Group>
    {deleteError ? <Alert color="red" title="操作未完成" mb="md">{deleteError}</Alert> : null}
    <Group mb="md" align="end">
      <TextInput aria-label="搜索项目、部门或负责人" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索项目、部门或负责人" leftSection={<Search size={16} />} miw={260} style={{ flex: 1 }} />
      <Select aria-label="筛选" value={status} onChange={(value) => setStatus(value ?? "all")} w={150} data={[{ value: "all", label: "全部状态" }, { value: "planning", label: "规划中" }, { value: "active", label: "进行中" }, { value: "completed", label: "已完成" }]} />
    </Group>
    {filtered.length ? <Box bd="1px solid var(--mantine-color-gray-3)" bg="white" style={{ borderRadius: "var(--mantine-radius-md)", overflow: "hidden" }}>
      <Table.ScrollContainer minWidth={900}><Table striped highlightOnHover verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>项目名称</Table.Th><Table.Th>描述</Table.Th><Table.Th>状态</Table.Th><Table.Th>所属部门</Table.Th><Table.Th>项目负责人</Table.Th><Table.Th>更新时间</Table.Th><Table.Th><span className="sr-only">操作</span></Table.Th></Table.Tr></Table.Thead><Table.Tbody>{filtered.map((project) => {
        const summary = summaries.get(project.id); const projectHref = `/data-spaces/projects/${project.id}`;
        return <Table.Tr key={project.id}><Table.Td><Button variant="subtle" px={0} onClick={() => router.push(projectHref)}>{project.name}</Button></Table.Td><Table.Td><Text size="sm" c="dimmed" lineClamp={1}>{project.description || "暂无描述"}</Text></Table.Td><Table.Td><Badge color={statusColor[project.status] ?? "gray"} variant="light">{statusLabel(project.status)}</Badge></Table.Td><Table.Td><Text size="sm" c="dimmed">{summary?.departmentName ?? "未分配"}</Text></Table.Td><Table.Td><Text size="sm" c="dimmed">{project.managerDisplayName ?? "待分配"}</Text></Table.Td><Table.Td><Text size="sm" c="dimmed">{dateLabel(summary?.latestActivityAt ?? project.updatedAt)}</Text></Table.Td><Table.Td><Menu position="bottom-end"><Menu.Target><Button variant="subtle" size="compact-sm" aria-label={`${project.name} 操作`}><MoreHorizontal size={18} /></Button></Menu.Target><Menu.Dropdown><Menu.Item onClick={() => router.push(projectHref)}>打开项目</Menu.Item><Menu.Item onClick={() => router.push(`${projectHref}/files`)}>查看资料</Menu.Item><Menu.Item onClick={() => router.push(`/assistant?project=${encodeURIComponent(project.id)}`)}>前往 AI 助手</Menu.Item>{project.permissions.canDeleteProject ? <Menu.Item color="red" onClick={() => setDeleteTarget(project)}>删除项目</Menu.Item> : null}</Menu.Dropdown></Menu></Table.Td></Table.Tr>;
      })}</Table.Tbody></Table></Table.ScrollContainer>
    </Box> : <Box ta="center" py={80} bd="1px solid var(--mantine-color-gray-3)" bg="white" style={{ borderRadius: "var(--mantine-radius-md)" }}><FolderKanban size={32} color="var(--mantine-color-gray-5)" /><Title order={4} mt="sm">没有匹配的项目</Title><Text size="sm" c="dimmed" mt={4}>调整筛选条件，或创建第一个项目。</Text>{viewer.canCreateProject ? <CreateProjectDialog managerName={viewer.user.displayName} trigger={<Button mt="md" leftSection={<Plus size={16} />}>创建项目</Button>} /> : null}</Box>}
    <Modal opened={deleteTarget !== null} onClose={() => { if (!deleting) setDeleteTarget(null); }} title="删除项目？" centered>
      <Text size="sm">项目、项目资料、历史版本、解析结果、会话和 AI 生成文档都会被永久删除，无法恢复。确认继续吗？</Text>
      <Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button><Button color="red" loading={deleting} onClick={() => void deleteProject()}>确认删除</Button></Group>
    </Modal>
  </main>;
}
