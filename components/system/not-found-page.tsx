import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { Button, PageHeader } from "@/components/common";
export function NotFoundPage({ path }: { path: string }) { return <div className="mx-auto max-w-2xl py-20 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Compass className="size-6" /></span><PageHeader className="mt-5 block" title="页面尚未接入" description={`路径 ${path} 已被路由系统识别，但当前 MVP 尚无对应模块。`} /><Link href="/dashboard" className="mt-6 inline-block"><Button><ArrowLeft className="size-4" />返回工作台</Button></Link></div>; }
