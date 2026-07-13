"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft, CheckCircle2, Info, LoaderCircle, Plus, Save, Sparkles, X } from "lucide-react";

const projectSchema = z.object({
  name: z.string().min(2, "请输入至少 2 个字符的项目名称"),
  client: z.string().min(2, "请输入客户名称"),
  manager: z.string().min(1, "请选择项目经理"),
  members: z.array(z.string()).min(1, "请至少添加一位项目成员"),
  type: z.string().min(1, "请选择项目类型"),
  objective: z.string().min(10, "请用至少 10 个字符描述项目目标"),
  targetLaunchDate: z.string().min(1, "请选择目标上线日期"),
  stage: z.string().min(1, "请选择当前阶段"),
  status: z.string().min(1),
  notes: z.string().max(500, "备注不能超过 500 个字符"),
});

type ProjectFormValues = z.infer<typeof projectSchema>;

export function CreateProjectPage() {
  const router = useRouter();
  const [memberInput, setMemberInput] = useState("");
  const [submittedName, setSubmittedName] = useState("");
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: "",
      client: "",
      manager: "林可",
      members: ["林可"],
      type: "digitalExperience",
      objective: "",
      targetLaunchDate: "",
      stage: "discovery",
      status: "planning",
      notes: "",
    },
  });
  // React Hook Form intentionally exposes a subscription-based watch API.
  // eslint-disable-next-line react-hooks/incompatible-library
  const members = watch("members");

  const addMember = () => {
    const name = memberInput.trim();
    if (!name || members.includes(name)) return;
    setValue("members", [...members, name], { shouldDirty: true, shouldValidate: true });
    setMemberInput("");
  };

  const submit = async (values: ProjectFormValues) => {
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    setSubmittedName(values.name);
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
            <button type="button" onClick={() => router.push("/projects/local-project/overview")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">进入项目空间 <ArrowLeft className="size-4 rotate-180" /></button>
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><Sparkles className="size-3.5" />项目经理工作台</span>
          </div>
        </header>

        <form onSubmit={handleSubmit(submit)} className="space-y-5">
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold text-foreground">基本信息</h2><p className="mt-1 text-xs text-muted-foreground">用于识别项目和分配主要负责人。</p></div>
            <div className="grid gap-5 p-5 md:grid-cols-2">
              <Field label="项目名称" required error={errors.name?.message}><input {...register("name")} autoFocus placeholder="例如：全球活动素材管理平台" className={inputClasses(Boolean(errors.name))} /></Field>
              <Field label="客户名称" required error={errors.client?.message}><input {...register("client")} placeholder="例如：LUMINA 全球品牌部" className={inputClasses(Boolean(errors.client))} /></Field>
              <Field label="项目经理" required error={errors.manager?.message}><select {...register("manager")} className={inputClasses(Boolean(errors.manager))}><option>林可</option><option>周霖</option><option>陈舟</option><option>吴桐</option></select></Field>
              <Field label="项目类型" required error={errors.type?.message}><select {...register("type")} className={inputClasses(Boolean(errors.type))}><option value="digitalExperience">数字体验项目</option><option value="platform">平台建设</option><option value="campaign">营销活动</option><option value="aiOptimization">AI 能力优化</option><option value="data">数据产品</option></select></Field>
              <div className="md:col-span-2">
                <Field label="项目成员" required hint="输入姓名后按回车添加" error={errors.members?.message}>
                  <div className={`rounded-lg border bg-background p-2 focus-within:ring-2 focus-within:ring-primary/15 ${errors.members ? "border-destructive" : "border-input focus-within:border-primary"}`}>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {members.map((member) => <span key={member} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground">{member}<button type="button" aria-label={`移除 ${member}`} onClick={() => setValue("members", members.filter((item) => item !== member), { shouldDirty: true, shouldValidate: true })} className="rounded text-muted-foreground hover:text-destructive"><X className="size-3" /></button></span>)}
                    </div>
                    <div className="flex gap-2"><input value={memberInput} onChange={(event) => setMemberInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addMember(); } }} placeholder="添加项目成员" className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground" /><button type="button" onClick={addMember} className="inline-flex h-8 items-center gap-1 rounded-md bg-muted px-2 text-xs font-medium text-foreground hover:bg-muted/70"><Plus className="size-3.5" />添加</button></div>
                  </div>
                </Field>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold text-foreground">交付设定</h2><p className="mt-1 text-xs text-muted-foreground">定义当前状态和目标，后续可在项目概览中更新。</p></div>
            <div className="grid gap-5 p-5 md:grid-cols-2">
              <div className="md:col-span-2"><Field label="项目目标" required hint="明确业务目标、交付结果和成功标准" error={errors.objective?.message}><textarea {...register("objective")} rows={4} placeholder="例如：在 Q4 前上线全球活动素材协作平台，将素材检索时间降低 60%，并建立可追溯的版本审批流程。" className={inputClasses(Boolean(errors.objective))} /></Field></div>
              <Field label="目标上线日期" required error={errors.targetLaunchDate?.message}><input type="date" {...register("targetLaunchDate")} className={inputClasses(Boolean(errors.targetLaunchDate))} /></Field>
              <Field label="当前阶段" required error={errors.stage?.message}><select {...register("stage")} className={inputClasses(Boolean(errors.stage))}><option value="discovery">项目发现</option><option value="requirement">需求确认</option><option value="design">方案设计</option><option value="delivery">交付实施</option><option value="testing">联调测试</option><option value="launch">上线准备</option></select></Field>
              <Field label="初始状态" required error={errors.status?.message}><select {...register("status")} className={inputClasses(Boolean(errors.status))}><option value="planning">规划中</option><option value="active">进行中</option><option value="paused">已暂停</option></select></Field>
              <Field label="备注" hint="最多 500 字" error={errors.notes?.message}><textarea {...register("notes")} rows={3} placeholder="补充客户背景、合作边界或其他说明" className={inputClasses(Boolean(errors.notes))} /></Field>
            </div>
          </section>

          <aside className="flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm text-foreground"><Info className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">创建后不会自动写入正式项目数据</p><p className="mt-1 text-xs leading-5 text-muted-foreground">后续 AI 提取的需求、Scope 和 Action Plan 将先进入审核中心，经人工确认后才会写入项目。</p></div></aside>

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
