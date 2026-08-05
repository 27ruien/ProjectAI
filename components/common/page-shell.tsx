import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageShell({ children, width = "wide", className }: { children: ReactNode; width?: "wide" | "data" | "form" | "full"; className?: string }) {
  return <main className={cn("mx-auto w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8", width === "wide" && "max-w-7xl", width === "data" && "max-w-[1600px]", width === "form" && "max-w-3xl", className)}>{children}</main>;
}

export function SectionHeader({ title, description, action, className }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}><div><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}</div>{action ? <div className="shrink-0">{action}</div> : null}</div>;
}
