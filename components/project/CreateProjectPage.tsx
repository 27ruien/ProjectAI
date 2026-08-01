"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Department = { id: string; name: string };

export function CreateProjectDialog({ managerName, trigger, defaultOpen = false }: { managerName: string; trigger?: React.ReactNode; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
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
      .then((payload) => { setDepartments(payload.departments ?? []); setDepartmentId((current) => current || payload.departments?.[0]?.id || ""); })
      .catch((caught: unknown) => { if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("部门列表加载失败"); });
    return () => controller.abort();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const response = await fetch(withBasePath("/api/projects"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, clientName: "内部项目", description, departmentId, status, stage: "discovery", health: "healthy", targetLaunchDate: null }) });
      const payload = await response.json() as { project?: { id: string }; error?: { message?: string } };
      if (!response.ok || !payload.project) throw new Error(payload.error?.message ?? "创建项目失败");
      setOpen(false);
      router.push(`/data-spaces/projects/${payload.project.id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建项目失败"); } finally { setSaving(false); }
  };

  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next && defaultOpen) router.push("/data-spaces/projects"); }}>
    {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
    <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl" data-testid="create-project-dialog">
      <DialogHeader><DialogTitle>创建项目</DialogTitle><DialogDescription>填写启动内部项目所需的最少信息。</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <label className="grid gap-1.5 text-sm font-medium">项目名称<Input required minLength={2} maxLength={200} value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
        <label className="grid gap-1.5 text-sm font-medium">项目描述<Textarea maxLength={4000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">所属部门<Select value={departmentId} onValueChange={setDepartmentId}><SelectTrigger className="w-full"><SelectValue placeholder="请选择部门" /></SelectTrigger><SelectContent>{departments.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-1.5 text-sm font-medium">项目状态<Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="planning">规划中</SelectItem><SelectItem value="active">进行中</SelectItem><SelectItem value="completed">已完成</SelectItem></SelectContent></Select></label>
        </div>
        <label className="grid gap-1.5 text-sm font-medium">项目负责人<Input readOnly value={managerName} className="bg-muted text-muted-foreground" /></label>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={saving || !departmentId}>{saving ? <LoaderCircle className="animate-spin" /> : null}创建项目</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export function CreateProjectPage({ managerName }: { managerName: string }) {
  return <main className="min-h-[70vh]"><CreateProjectDialog managerName={managerName} defaultOpen trigger={<Button className="sr-only"><Plus />创建项目</Button>} /></main>;
}
