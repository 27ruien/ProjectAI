import Link from "next/link";
import { ArrowLeft, EyeOff, ShieldX } from "lucide-react";

export function AccessDeniedPage({ obscureResource = false }: { obscureResource?: boolean }) {
  return (
    <div className="grid min-h-[520px] place-items-center px-5 py-12 text-center">
      <section className="w-full max-w-lg">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-destructive-soft text-destructive">
          {obscureResource ? <EyeOff className="size-6" /> : <ShieldX className="size-6" />}
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{obscureResource ? "404" : "Access denied"}</p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{obscureResource ? "页面不存在或无法访问" : "当前身份没有此操作权限"}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{obscureResource ? "为保护项目标识，系统不会说明资源是否存在。请从已授权项目列表重新进入。" : "你的 Session 已验证，但当前角色不包含此页面或操作所需的权限。"}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/projects" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"><ArrowLeft className="size-4" />返回项目列表</Link>
          <Link href="/dashboard" className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted">返回工作台</Link>
        </div>
      </section>
    </div>
  );
}
