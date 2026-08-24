import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/common";
export function NotFoundPage({ path }: { path: string }) { void path; return <div className="mx-auto max-w-2xl py-20 text-center"><span className="mx-auto grid size-12 place-items-center rounded-lg border bg-muted/30 text-muted-foreground"><Compass className="size-5" /></span><p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">404</p><h1 className="mt-2 text-2xl font-semibold leading-8">页面不存在</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">页面可能已移动，或你的账号没有访问权限。</p><Link href="/projects" className="mt-6 inline-block"><Button><ArrowLeft className="size-4" />返回项目</Button></Link></div>; }
