"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Drawer({ open, onClose, title, description, children, footer, width = "max-w-xl" }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = previous; };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={title}><button className="absolute inset-0 z-0 bg-[var(--overlay)]" onClick={onClose} aria-label="关闭抽屉" /><section className={cn("absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l bg-card shadow-[var(--shadow-float)] page-enter", width)}><header className="flex items-start gap-4 border-b px-5 py-4"><div className="min-w-0 flex-1"><h2 className="font-semibold">{title}</h2>{description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}</div><button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="关闭"><X className="size-4" /></button></header><div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>{footer ? <footer className="border-t bg-card px-5 py-3">{footer}</footer> : null}</section></div>;
}
