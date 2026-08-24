"use client";

import { type FormEvent, useState } from "react";
import { LoaderCircle, Pencil } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { withBasePath } from "@/lib/base-path";
import { Alert, Button, Group, Modal, Select, Stack, TextInput, Textarea, Title } from "@/components/ui/project-primitives";

export function ProjectEditDialog({ project }: { project: AuthorizedProjectSummary }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState(project.status);
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [targetLaunchDate, setTargetLaunchDate] = useState(project.targetLaunchDate ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, clientName, description, status, startDate: startDate || null, targetLaunchDate: targetLaunchDate || null }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "项目保存失败");
      setOpen(false);
      location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="default" size="sm" onClick={() => setOpen(true)} leftSection={<Pencil size={14} />}>编辑项目</Button>
      <Modal opened={open} onClose={() => !saving && setOpen(false)} title={<Title order={3}>编辑项目</Title>} centered size="lg">
        <form onSubmit={submit}>
          <Stack gap="md">
            <TextInput label="项目名称" required minLength={2} maxLength={200} value={name} onChange={(event) => setName(event.currentTarget.value)} />
            <TextInput label="客户名称" required minLength={2} maxLength={200} value={clientName} onChange={(event) => setClientName(event.currentTarget.value)} />
            <Textarea label="项目描述" maxLength={4000} minRows={4} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
            <Select label="项目状态" value={status} onChange={(value) => setStatus(value ?? "planning")} data={[{ value: "planning", label: "规划中" }, { value: "active", label: "进行中" }, { value: "completed", label: "已完成" }]} />
            <Group grow align="flex-start">
              <TextInput type="date" label="开始时间" value={startDate} onChange={(event) => setStartDate(event.currentTarget.value)} />
              <TextInput type="date" label="目标时间" value={targetLaunchDate} onChange={(event) => setTargetLaunchDate(event.currentTarget.value)} />
            </Group>
            {error ? <Alert color="red" title="保存失败">{error}</Alert> : null}
            <Group justify="flex-end"><Button type="button" variant="default" disabled={saving} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={saving} leftSection={saving ? <LoaderCircle size={16} className="animate-spin" /> : undefined}>{saving ? "正在保存" : "保存修改"}</Button></Group>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
