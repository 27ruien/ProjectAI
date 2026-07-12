import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const tones: Record<BadgeTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  primary: "border-primary/15 bg-primary/10 text-primary",
  success: "border-success/15 bg-success-soft text-success",
  warning: "border-warning/15 bg-warning-soft text-warning",
  danger: "border-destructive/15 bg-destructive-soft text-destructive",
  info: "border-info/15 bg-info-soft text-info",
};

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone], className)}
      {...props}
    />
  );
}
