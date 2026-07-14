"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AlertCircle, ArrowLeft, CheckCircle2, Info, LoaderCircle, Save, Sparkles } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

const projectSchema = z.object({
  name: z.string().min(2, "请输入至少 2 个字符的项目名称"),
  client: z.string().min(2, "请输入客户名称"),
  objective: z.string().min(10, "请用至少 10 个字符描述项目目标"),
  targetLaunchDate: z.string().min(1, "请选择目标上线日期"),
  stage: z.string().min(1, "请选择当前阶段"),
  status: z.string().min(1),
  notes: z.string().max(500, "备注不能超过 500 个字符"),
});

type ProjectFormValues = z.infer<typeof projectSchema>;

export function CreateProjectPage() {
  const router = useRouter();
  const [submittedName, setSubmittedName] = useState("");
  const [createdProjectId, setCreatedProjectId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      client: "",
      objective: "",
      targetLaunchDate: "",
      stage: "discovery",
      status: "planning",
      notes: "",
    },
  });
  const submit = async (values: ProjectFormValues) => {
    setSubmitError(null);
    try {
      const response = await fetch(withBasePath("/api/projects"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          clientName: values.client.trim(),
          description: [values.objective.trim(), values.notes.trim()].filter(Boolean).join("\n\n"),
          targetLaunchDate: values.targetLaunchDate,
          stage: values.stage,
          status: values.status,
          health: "healthy",
        }),
      });
      if (!response.ok) throw new Error("CREATE_PROJECT_FAILED");
      const result = await response.json() as { id?: string; project?: { id?: string } };
      const id = result.project?.id ?? result.id;
      if (!id) throw new Error("CREATE_PROJECT_FAILED");
      setCreatedProjectId(id);
      setSubmittedName(values.name);
    } catch {
      setSubmitError("项目创建失败，请检查输入后重试。若问题持续，请联系系统管理员。");
    }
  };

  if (submittedName) {
    return (
      <main className="grid min-h-full place-items-center bg-background px-5 py-10">
        <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-success/10 text-success"><CheckCircle2 className="size-6" /></span>
          <h1 className="mt-5 text-xl font-semibold text-foreground">项目已创建</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">“{submittedName}”已加入项目列表。资料、知识和 AI 产出会在该项目空间内隔离管理。</p>
          <div className="mt-6 flex justify-center gap-2">
            <button type="button" onClick={() => router.push("/projects")} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted">返回项目列表</button>
            <button type="button" onClick={() => router.push(`/projects/${createdProjectId}/overview`)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">进入项目空间 <ArrowLeft className="size-4 rotate-180" /></button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-full bg-background px-5 py-6 lg:px-8 lg:py-7">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <Link href="/projects" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />返回项目列表</Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h1 className="text-2xl font-semibold tracking-tight text-foreground">创建项目</h1><p className="mt-1.5 text-sm text-muted-foreground">建立独立的项目资料、知识、需求与 AI 工作空间。</p></div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><Sparkles className="size-3.5" />系统管理员工作台</span>
          </div>
        </header>

        <form onSubmit={handleSubmit(submit)} className="space-y-5">
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold text-foreground">基本信息</h2><p className="mt-1 text-xs text-muted-foreground">用于识别项目和分配主要负责人。</p></div>
            <div className="grid gap-5 p-5 md:grid-cols-2">
              <Field label="项目名称" required error={errors.name?.message}><input {...register("name")} autoFocus placeholder="请输入项目名称" className={inputClasses(Boolean(errors.name))} /></Field>
              <Field label="客户名称" required error={errors.client?.message}><input {...register("client")} placeholder="请输入客户或业务方名称" className={inputClasses(Boolean(errors.client))} /></Field>
              <div className="md:col-span-2 rounded-lg border border-info/15 bg-info-soft px-3 py-2.5 text-xs leading-5 text-info">创建人会由服务端自动加入项目并成为项目经理。成员管理将在项目授权接口中完成，浏览器不会提交或决定项目角色。</div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold text-foreground">交付设定</h2><p className="mt-1 text-xs text-muted-foreground">定义当前状态和目标，后续可在项目概览中更新。</p></div>
            <div className="grid gap-5 p-5 md:grid-cols-2">
              <div className="md:col-span-2"><Field label="项目目标" required hint="明确业务目标、交付结果和成功标准" error={errors.objective?.message}><textarea {...register("objective")} rows={4} placeholder="描述业务目标、交付结果和可验证的成功标准" className={inputClasses(Boolean(errors.objective))} /></Field></div>
              <Field label="目标上线日期" required error={errors.targetLaunchDate?.message}><input type="date" {...register("targetLaunchDate")} className={inputClasses(Boolean(errors.targetLaunchDate))} /></Field>
              <Field label="当前阶段" required error={errors.stage?.message}><select {...register("stage")} className={inputClasses(Boolean(errors.stage))}><option value="discovery">项目发现</option><option value="planning">项目规划</option><option value="design">方案设计</option><option value="development">开发实施</option><option value="testing">联调测试</option><option value="launch">上线准备</option><option value="operation">运营维护</option></select></Field>
              <Field label="初始状态" required error={errors.status?.message}><select {...register("status")} className={inputClasses(Boolean(errors.status))}><option value="planning">规划中</option><option value="active">进行中</option><option value="paused">已暂停</option></select></Field>
              <Field label="备注" hint="最多 500 字" error={errors.notes?.message}><textarea {...register("notes")} rows={3} placeholder="补充客户背景、合作边界或其他说明" className={inputClasses(Boolean(errors.notes))} /></Field>
            </div>
          </section>

          <aside className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-foreground"><Info className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">创建后不会自动写入正式项目数据</p><p className="mt-1 text-xs leading-5 text-muted-foreground">后续 AI 提取的需求、Scope 和 Action Plan 将先进入审核中心，经人工确认后才会写入项目。</p></div></aside>

          {submitError ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive-soft px-4 py-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{submitError}</div> : null}

          <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
            <p className="hidden text-xs text-muted-foreground sm:block">{isDirty ? "表单有未保存的修改" : "填写必填信息后即可创建"}</p>
            <div className="ml-auto flex gap-2"><Link href="/projects" className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted">取消</Link><button type="submit" disabled={isSubmitting} className="inline-flex h-9 min-w-28 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? <><LoaderCircle className="size-4 animate-spin" />正在创建</> : <><Save className="size-4" />创建项目</>}</button></div>
          </div>
        </form>
      </div>
    </main>
  );
}

function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 flex items-center justify-between text-xs font-medium text-foreground"><span>{label}{required && <span className="ml-1 text-destructive">*</span>}</span>{hint && <span className="font-normal text-muted-foreground">{hint}</span>}</span>{children}{error && <span className="mt-1.5 block text-xs text-destructive">{error}</span>}</label>;
}

function inputClasses(invalid: boolean) {
  return `w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/15 ${invalid ? "border-destructive focus:border-destructive" : "border-input focus:border-primary"}`;
}

export default CreateProjectPage;
