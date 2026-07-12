import Link from "next/link";
import { Bell, Bot, ChevronRight, FileClock, LockKeyhole, Settings2 } from "lucide-react";
import { Badge, PageHeader } from "@/components/common";

const sections = [
  { title: "AI 模型管理", description: "供应商、模型注册、Model Profiles、Skill 关联与调用日志", href: "/settings/ai-models", icon: Bot, tag: "已配置" },
  { title: "权限管理", description: "项目级权限、资料访问范围与审核角色（后续阶段）", href: "/settings/permissions", icon: LockKeyhole, tag: "预留" },
  { title: "通知设置", description: "审核、风险、Action 到期与 Workflow 执行通知（后续阶段）", href: "/settings/notifications", icon: Bell, tag: "预留" },
  { title: "系统日志", description: "关键业务修改、人工审核与数据写入审计记录（后续阶段）", href: "/settings/logs", icon: FileClock, tag: "预留" },
];
export function SettingsPage() { return <div className="space-y-6"><PageHeader eyebrow="System" title="系统设置" description="管理 AI 基础设施、权限边界、通知与审计能力。首期只开放 AI 模型管理只读视图。" /><section className="app-card divide-y">{sections.map((section) => { const Icon = section.icon; return <Link key={section.title} href={section.href} aria-disabled={section.href === "#"} className="group flex items-center gap-4 p-5 transition-colors hover:bg-surface"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary"><Icon className="size-[18px]" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">{section.title}</h2><Badge tone={section.tag === "已配置" ? "success" : "neutral"}>{section.tag}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{section.description}</p></div><ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></Link>; })}</section><div className="rounded-xl border border-primary/15 bg-primary/[0.035] p-4"><div className="flex items-start gap-3"><Settings2 className="mt-0.5 size-4 text-primary" /><div><p className="text-xs font-semibold">安全原则</p><p className="mt-1 text-xs leading-5 text-muted-foreground">前端不保存 API Key；Skill 只引用 Model Profile；所有调用经统一 AI Gateway，正式数据写入必须通过人工审核。</p></div></div></div></div>; }
