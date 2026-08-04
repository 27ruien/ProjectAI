"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput, Textarea, Title } from "@mantine/core";
import { LoaderCircle, Plus } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

type Department = { id: string; name: string };

export function CreateProjectDialog({ managerName, trigger, defaultOpen = false }: { managerName: string; trigger?: React.ReactNode; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [status, setStatus] = useState("planning");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(withBasePath("/api/projects/creation-context"), { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { departments?: Department[]; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message ?? "部门列表加载失败");
        return payload;
      })
      .then((payload) => {
        setDepartments(payload.departments ?? []);
        setDepartmentId((current) => current ?? payload.departments?.[0]?.id ?? null);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("部门列表加载失败");
      });
    return () => controller.abort();
  }, []);

  const close = () => {
    setOpen(false);
    if (defaultOpen) router.push("/data-spaces/projects");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(withBasePath("/api/projects"), {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, clientName: "内部项目", description, departmentId, status, stage: "discovery", health: "healthy", targetLaunchDate: null }),
      });
      const payload = await response.json() as { project?: { id: string }; error?: { message?: string } };
      if (!response.ok || !payload.project) throw new Error(payload.error?.message ?? "创建项目失败");
      setOpen(false);
      router.push(`/data-spaces/projects/${payload.project.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建项目失败");
    } finally { setSaving(false); }
  };

  return <>
    {trigger ? <span onClick={() => setOpen(true)}>{trigger}</span> : null}
    <Modal opened={open} onClose={close} title={<Title order={3}>创建项目</Title>} centered size="lg" data-testid="create-project-dialog">
      <Text size="sm" c="dimmed" mb="md">填写启动内部项目所需的最少信息。</Text>
      <form onSubmit={submit}>
        <Stack gap="md">
          <TextInput label="项目名称" required minLength={2} maxLength={200} value={name} onChange={(event) => setName(event.currentTarget.value)} autoFocus />
          <Textarea label="项目描述" maxLength={4000} minRows={4} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
          <Group grow align="flex-start">
            <Select label="所属部门" required value={departmentId} onChange={setDepartmentId} data={departments.map((item) => ({ value: item.id, label: item.name }))} placeholder="请选择部门" />
            <Select label="项目状态" value={status} onChange={(value) => setStatus(value ?? "planning")} data={[{ value: "planning", label: "规划中" }, { value: "active", label: "进行中" }, { value: "completed", label: "已完成" }]} />
          </Group>
          <TextInput label="项目负责人" readOnly value={managerName} />
          {error ? <Alert color="red" title="创建失败">{error}</Alert> : null}
          <Group justify="flex-end"><Button variant="default" type="button" onClick={close}>取消</Button><Button type="submit" disabled={saving || !departmentId} leftSection={saving ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}>创建项目</Button></Group>
        </Stack>
      </form>
    </Modal>
  </>;
}

export function CreateProjectPage({ managerName }: { managerName: string }) {
  return <main className="min-h-[70vh]"><CreateProjectDialog managerName={managerName} defaultOpen trigger={<Button className="sr-only" leftSection={<Plus size={16} />}>创建项目</Button>} /></main>;
}
