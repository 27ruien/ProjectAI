"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Divider,
  Group,
  Menu,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@/components/ui/project-primitives";
import { LoaderCircle, MoreHorizontal, Pencil } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { dateLabel, statusLabel } from "./mock-view";

type Summary = {
  departmentName: string | null;
  fileCount: number;
  requirementCount: number;
  currentRequirementVersion: number | null;
  latestActivityAt: string;
};

async function deleteErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? "删除项目失败，请稍后重试";
  } catch {
    return "删除项目失败，请稍后重试";
  }
}

export function ProjectOverviewPage({
  project,
}: {
  project: AuthorizedProjectSummary;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState(project.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(withBasePath("/api/projects/focused-summaries"), {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(
        async (response) =>
          response.json() as Promise<{
            summaries: Array<Summary & { projectId: string }>;
          }>,
      )
      .then((payload) => {
        setSummary(
          payload.summaries.find((item) => item.projectId === project.id) ?? null,
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [project.id]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description, status }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "保存失败");
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setError(null);
    const response = await fetch(withBasePath(`/api/projects/${project.id}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (!response.ok) {
      setError(await deleteErrorMessage(response));
      setConfirmDelete(false);
      return;
    }
    setConfirmDelete(false);
    router.replace("/data-spaces/projects");
  };

  const infos: Array<[string, string]> = [
    ["状态", statusLabel(project.status)],
    ["负责人", project.managerDisplayName ?? "待分配"],
    ["部门", summary?.departmentName ?? "未分配部门"],
    ["创建时间", dateLabel(project.createdAt)],
    ["更新时间", dateLabel(project.updatedAt)],
    ["最近活动", dateLabel(summary?.latestActivityAt ?? project.updatedAt)],
    ["成员数量", `${project.memberCount}`],
    ["项目资料数量", `${summary?.fileCount ?? "—"}`],
    [
      "当前需求概览版本",
      summary?.currentRequirementVersion
        ? `v${summary.currentRequirementVersion}`
        : "尚未生成",
    ],
  ];

  const actions = (
    <Group gap="xs">
      {project.permissions.canEditProject ? (
        <Button
          variant="default"
          leftSection={<Pencil size={16} />}
          onClick={() => setEditing(true)}
        >
          编辑项目
        </Button>
      ) : null}
      {project.permissions.canDeleteProject ? (
        <Menu position="bottom-end">
          <Menu.Target>
            <Button variant="subtle" size="compact-sm" aria-label="更多项目操作">
              <MoreHorizontal size={18} />
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item color="red" onClick={() => setConfirmDelete(true)}>
              删除项目
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      ) : null}
    </Group>
  );

  return (
    <div className="min-h-full">
      <ProjectContextHeader project={project} activeTab="overview" actions={actions} />
      <Box px={{ base: "md", sm: "lg" }} py="xl">
        {error ? (
          <Alert color="red" title="操作未完成" mb="lg">
            {error}
          </Alert>
        ) : null}
        <Title order={3}>基本信息</Title>
        <Text size="sm" c="dimmed" mt={5}>
          关键项目信息和当前资料状态。
        </Text>
        <dl>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mt="lg" spacing="md">
            {infos.map(([label, value]) => (
              <Box
                component="div"
                key={label}
                p="md"
                bg="white"
                bd="1px solid var(--border)"
                style={{ borderRadius: "var(--radius)" }}
              >
                <Text component="dt" size="xs" c="dimmed">
                  {label}
                </Text>
                <Text component="dd" size="sm" mt={6} ml={0}>
                  {value}
                </Text>
              </Box>
            ))}
            <Box
              component="div"
              p="md"
              bg="white"
              bd="1px solid var(--border)"
              style={{ borderRadius: "var(--radius)" }}
            >
              <Text component="dt" size="xs" c="dimmed">
                项目描述
              </Text>
              <Text component="dd" size="sm" mt={6} ml={0}>
                {project.description || "暂无描述"}
              </Text>
            </Box>
          </SimpleGrid>
        </dl>
      </Box>

      <Modal opened={editing} onClose={() => setEditing(false)} title="编辑项目" centered>
        <Text size="sm" c="dimmed" mb="md">
          更新项目名称、描述和状态。
        </Text>
        <form onSubmit={save}>
          <Stack>
            <TextInput
              label="项目名称"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              minLength={2}
              maxLength={200}
            />
            <Textarea
              label="项目描述"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              minRows={5}
              maxLength={4000}
            />
            <Select
              label="状态"
              value={status}
              onChange={(value) => setStatus(value ?? "planning")}
              data={[
                { value: "planning", label: "规划中" },
                { value: "active", label: "进行中" },
                { value: "completed", label: "已完成" },
              ]}
            />
            {error ? <Alert color="red">{error}</Alert> : null}
            <Group justify="flex-end">
              <Button variant="default" type="button" onClick={() => setEditing(false)}>
                取消
              </Button>
              <Button
                type="submit"
                loading={saving}
                leftSection={saving ? <LoaderCircle size={16} /> : null}
              >
                保存
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <Modal
        opened={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="删除项目？"
        centered
      >
        <Text size="sm">
          项目、项目资料、历史版本、解析结果、会话和 AI 生成文档都会被永久删除，无法恢复。
        </Text>
        <Divider my="md" />
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button color="red" onClick={() => void remove()}>
            确认删除
          </Button>
        </Group>
      </Modal>
    </div>
  );
}
