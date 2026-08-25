import { LockKeyhole, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/common";

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="系统" title="基础设置" description="Project AI 的模型、RAGFlow 数据集、提示词和凭据均由服务端配置，不向普通用户开放。" />
      <section className="app-card p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary"><LockKeyhole className="size-[18px]" /></span>
          <div><h2 className="text-sm font-semibold">权限边界</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">项目成员关系决定项目知识访问权限。管理员只能通过受保护的组织与项目接口维护用户和成员。</p></div>
        </div>
      </section>
      <div className="rounded-xl border border-primary/15 bg-primary/[0.035] p-4"><div className="flex items-start gap-3"><Settings2 className="mt-0.5 size-4 text-primary" /><p className="text-xs leading-5 text-muted-foreground">任何模型服务或知识服务密钥都只允许通过服务器环境变量或只读密钥文件注入。</p></div></div>
    </div>
  );
}
