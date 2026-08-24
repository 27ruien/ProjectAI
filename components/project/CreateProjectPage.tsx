"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput, Textarea, Title } from "@/components/ui/project-primitives";

export function CreateProjectDialog({
  managerName,
  trigger,
  defaultOpen = false,
}: {
  managerName: string;
  trigger?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("planning");
  const [startDate, setStartDate] = useState("");
  const [targetLaunchDate, setTargetLaunchDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    if (defaultOpen) router.push("/projects");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(withBasePath("/api/projects"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          clientName,
          description,
          status,
          stage: "discovery",
          health: "healthy",
          startDate: startDate || null,
          targetLaunchDate: targetLaunchDate || null,
          departmentId: null,
        }),
      });
      const payload = (await response.json()) as {
        project?: { id: string };
        projectId?: string;
        error?: { message?: string };
      };
      if (!response.ok) {
        if (payload.projectId) {
          setOpen(false);
          router.push(`/projects/${payload.projectId}/knowledge`);
          return;
        }
        throw new Error(payload.error?.message ?? "创建项目失败");
      }
      if (!payload.project) throw new Error("创建项目失败");
      setOpen(false);
      router.push(`/projects/${payload.project.id}/knowledge`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建项目失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : null}
      <Modal opened={open} onClose={close} title={<Title order={3}>创建项目</Title>} centered size="lg">
        <Text size="sm" c="dimmed" mb="md">项目创建后会自动建立独立知识空间。</Text>
        <form onSubmit={submit}>
          <Stack gap="md">
            <TextInput label="项目名称" required minLength={2} maxLength={200} value={name} onChange={(event) => setName(event.currentTarget.value)} autoFocus />
            <TextInput label="客户名称" required minLength={2} maxLength={200} value={clientName} onChange={(event) => setClientName(event.currentTarget.value)} />
            <Textarea label="项目描述" maxLength={4000} minRows={4} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
            <Select label="项目状态" value={status} onChange={(value) => setStatus(value ?? "planning")} data={[{ value: "planning", label: "规划中" }, { value: "active", label: "进行中" }, { value: "completed", label: "已完成" }]} />
            <Group grow align="flex-start">
              <TextInput type="date" label="开始时间" value={startDate} onChange={(event) => setStartDate(event.currentTarget.value)} />
              <TextInput type="date" label="目标时间" value={targetLaunchDate} onChange={(event) => setTargetLaunchDate(event.currentTarget.value)} />
            </Group>
            <TextInput label="项目负责人" readOnly value={managerName} />
            {error ? <Alert color="red" title="创建失败">{error}</Alert> : null}
            <Group justify="flex-end"><Button variant="default" type="button" onClick={close}>取消</Button><Button type="submit" disabled={saving} leftSection={saving ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}>{saving ? "正在创建知识空间" : "创建项目"}</Button></Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function CreateProjectPage({ managerName }: { managerName: string }) {
  return <main className="min-h-[70vh]"><CreateProjectDialog managerName={managerName} defaultOpen trigger={<Button className="sr-only">创建项目</Button>} /></main>;
}
