"use client";

import { useState } from "react";
import { Bot, Clock3, FileCheck2, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { Badge, MetricCard, PageHeader } from "@/components/common";

const weekly = [
  { day: "周一", calls: 118, approved: 80 }, { day: "周二", calls: 164, approved: 122 }, { day: "周三", calls: 142, approved: 110 },
  { day: "周四", calls: 208, approved: 170 }, { day: "周五", calls: 186, approved: 154 }, { day: "周六", calls: 72, approved: 58 }, { day: "周日", calls: 46, approved: 40 },
];
const skillQuality = [
  { name: "需求提取", rate: 92, edit: 8 }, { name: "会议摘要", rate: 89, edit: 12 }, { name: "Scope 对比", rate: 86, edit: 15 },
  { name: "风险分析", rate: 82, edit: 19 }, { name: "Action Plan", rate: 88, edit: 13 },
];

export function AnalyticsPage() {
  const [range, setRange] = useState("近 7 天");
  const max = Math.max(...weekly.map((item) => item.calls));
  return <div className="space-y-6"><PageHeader eyebrow="Analytics" title="数据看板" description="观察 AI 对项目交付效率、审核质量与风险控制的真实贡献。" actions={<select value={range} onChange={(event) => setRange(event.target.value)} className="h-9 rounded-lg border bg-card px-3 text-xs"><option>近 7 天</option><option>近 30 天</option><option>本季度</option></select>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="AI 节省工时" value="126.5h" change="18.2%" icon={<Clock3 className="size-4" />} /><MetricCard label="AI 调用次数" value="936" change="12.4%" icon={<Bot className="size-4" />} /><MetricCard label="产出通过率" value="88.7%" change="3.1%" icon={<FileCheck2 className="size-4" />} /><MetricCard label="提前识别风险" value="17" change="5 项" icon={<ShieldAlert className="size-4" />} /></div>
    <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]"><section className="app-card p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">AI 调用与通过趋势</h2><p className="mt-1 text-xs text-muted-foreground">{range} · 调用总量与一次审核通过量</p></div><div className="flex gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><i className="size-2 rounded-full bg-primary" />调用</span><span className="flex items-center gap-1"><i className="size-2 rounded-full bg-success" />通过</span></div></div><div className="mt-7 flex h-56 items-end gap-3 border-b border-border px-2">{weekly.map((item) => <div key={item.day} className="flex h-full flex-1 flex-col justify-end"><div className="relative flex h-full items-end justify-center gap-1"><div className="w-[38%] rounded-t bg-primary/75 transition-all hover:bg-primary" style={{ height: `${(item.calls / max) * 88}%` }} title={`调用 ${item.calls}`} /><div className="w-[38%] rounded-t bg-success/65 transition-all hover:bg-success" style={{ height: `${(item.approved / max) * 88}%` }} title={`通过 ${item.approved}`} /></div><span className="py-2 text-center text-[10px] text-muted-foreground">{item.day}</span></div>)}</div></section>
      <section className="app-card p-5"><div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><h2 className="text-sm font-semibold">Skill 质量</h2></div><div className="mt-5 space-y-4">{skillQuality.map((item) => <div key={item.name}><div className="mb-1.5 flex items-center justify-between text-xs"><span>{item.name}</span><span className="font-medium">{item.rate}% <small className="ml-1 font-normal text-muted-foreground">修改 {item.edit}%</small></span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${item.rate}%` }} /></div></div>)}</div></section></div>
    <section className="app-card overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-sm font-semibold">项目 AI 价值排行</h2><p className="mt-1 text-xs text-muted-foreground">基于节省工时、产出通过率与风险预警综合计算</p></div><Badge tone="success"><TrendingUp className="mr-1 size-3" />本期提升 14.2%</Badge></div><div className="divide-y">{[
      ["北美旗舰店 AI 互动活动", "32.5h", "93%", "4"], ["品牌官网重构", "24.8h", "91%", "3"], ["会员系统升级", "19.6h", "87%", "2"], ["全球活动素材管理平台", "16.2h", "89%", "3"],
    ].map((row, index) => <div key={row[0]} className="grid grid-cols-[36px_1fr_repeat(3,minmax(80px,140px))] items-center gap-3 px-5 py-3 text-xs"><span className="text-muted-foreground">0{index + 1}</span><strong className="font-medium">{row[0]}</strong><span><small className="block text-[10px] text-muted-foreground">节省工时</small>{row[1]}</span><span><small className="block text-[10px] text-muted-foreground">通过率</small>{row[2]}</span><span><small className="block text-[10px] text-muted-foreground">风险预警</small>{row[3]} 项</span></div>)}</div></section>
  </div>;
}
