"use client";

import { AlertOctagon, AlertTriangle, CircleAlert, Info } from "lucide-react";

export const riskLevelConfig: Record<string, { label: string; style: string; icon: typeof AlertTriangle }> = {
  low: { label: "低", style: "bg-slate-500/10 text-slate-700", icon: Info },
  medium: { label: "中", style: "bg-amber-500/10 text-amber-700", icon: CircleAlert },
  high: { label: "高", style: "bg-orange-500/10 text-orange-700", icon: AlertTriangle },
  critical: { label: "严重", style: "bg-rose-500/10 text-rose-700", icon: AlertOctagon },
};

export function RiskBadge({ level, showIcon = true }: { level: string; showIcon?: boolean }) {
  const config = riskLevelConfig[level] ?? riskLevelConfig.medium;
  const Icon = config.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold ${config.style}`}>{showIcon ? <Icon className="size-2.5" /> : null}{config.label}风险</span>;
}

