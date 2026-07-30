"use client";

import Link from "next/link";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { withBasePath } from "@/lib/base-path";

type Department = { id: string; name: string };

export function CreateProjectPage({ managerName }: { managerName: string }) {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("planning");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch(withBasePath("/api/projects/creation-context"), { credentials: "include", cache: "no-store" })
      .then(async (response) => response.json() as Promise<{ departments?: Department[] }>)
      .then((payload) => { setDepartments(payload.departments ?? []); setDepartmentId(payload.departments?.[0]?.id ?? ""); })
      .catch(() => setError("部门列表加载失败"));
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const response = await fetch(withBasePath("/api/projects"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, clientName: "内部项目", description, departmentId, status, stage: "discovery", health: "healthy", targetLaunchDate: null }) });
      const payload = await response.json() as { project?: { id: string }; error?: { message?: string } };
      if (!response.ok || !payload.project) throw new Error(payload.error?.message ?? "创建项目失败");
      router.push(`/projects/${payload.project.id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建项目失败"); setSaving(false); }
  };
  return <main className="mx-auto max-w-3xl px-5 py-7 lg:px-8"><Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />返回项目</Link><div className="mt-5 rounded-xl border bg-card p-6"><h1 className="text-xl font-semibold">创建项目</h1><p className="mt-1 text-sm text-muted-foreground">只填写启动内部 MVP 所需的最少信息。</p><form onSubmit={submit} className="mt-6 space-y-5">
    <label className="block text-sm font-medium">项目名称<input required minLength={2} maxLength={200} value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-10 w-full rounded-lg border bg-background px-3 outline-none focus:border-primary" /></label>
    <label className="block text-sm font-medium">项目描述<textarea maxLength={4000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 w-full rounded-lg border bg-background px-3 py-2 outline-none focus:border-primary" /></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">所属部门<select required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="mt-2 h-10 w-full rounded-lg border bg-background px-3"><option value="">请选择部门</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="block text-sm font-medium">状态<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-2 h-10 w-full rounded-lg border bg-background px-3"><option value="planning">规划中</option><option value="active">进行中</option><option value="completed">已完成</option><option value="archived">已归档</option></select></label></div>
    <label className="block text-sm font-medium">项目经理<input readOnly value={managerName} className="mt-2 h-10 w-full rounded-lg border bg-muted px-3 text-muted-foreground" /><span className="mt-1 block text-xs font-normal text-muted-foreground">创建者自动成为项目经理。</span></label>
    {error ? <p className="rounded-lg border border-destructive/20 bg-destructive-soft p-3 text-sm text-destructive">{error}</p> : null}<div className="flex justify-end"><button disabled={saving || !departmentId} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? <LoaderCircle className="size-4 animate-spin" /> : null}创建项目</button></div>
  </form></div></main>;
}
