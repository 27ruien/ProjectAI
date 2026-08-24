import Link from "next/link";
import { ArrowLeft, EyeOff, ShieldX } from "lucide-react";

export function AccessDeniedPage({ obscureResource = false }: { obscureResource?: boolean }) {
  return (
    <div className="grid min-h-[520px] place-items-center px-5 py-12 text-center">
      <section className="w-full max-w-lg">
        <span className="mx-auto grid size-12 place-items-center rounded-lg border bg-muted/30 text-muted-foreground">
          {obscureResource ? <EyeOff className="size-6" /> : <ShieldX className="size-6" />}
        </span>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{obscureResource ? "404" : "无访问权限"}</p>
        <h1 className="mt-2 text-2xl font-semibold leading-8 text-foreground">{obscureResource ? "页面不存在" : "无访问权限"}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{obscureResource ? "页面可能已移动，或你的账号没有访问权限。" : "你的账号无权访问此页面或执行此操作。"}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/projects" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"><ArrowLeft className="size-4" />返回项目</Link>
        </div>
      </section>
    </div>
  );
}
