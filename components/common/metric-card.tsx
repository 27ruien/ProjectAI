import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function MetricCard({ label, value, change, trend = "up", icon, hint, className }: { label: string; value: string | number; change?: string; trend?: "up" | "down" | "neutral"; icon?: ReactNode; hint?: string; className?: string }) {
  return <article className={cn("app-card min-w-0 p-4", className)}><div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-muted-foreground">{label}</span>{icon ? <span className="grid size-8 place-items-center rounded-lg bg-primary/8 text-primary">{icon}</span> : null}</div><div className="mt-2 flex items-end gap-2"><strong className="text-2xl font-semibold tracking-[-0.03em]">{value}</strong>{change ? <span className={cn("mb-0.5 inline-flex items-center text-[11px]", trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground")}>{trend === "up" ? <ArrowUpRight className="size-3" /> : trend === "down" ? <ArrowDownRight className="size-3" /> : null}{change}</span> : null}</div>{hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}</article>;
}
