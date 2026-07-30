"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export function Drawer({ open, onClose, title, description, children, footer, width = "max-w-xl" }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  return <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}><SheetContent side="right" className={cn("flex w-full flex-col gap-0 p-0 sm:max-w-none", width)}><SheetHeader className="border-b px-5 py-4 text-left"><SheetTitle>{title}</SheetTitle>{description ? <SheetDescription>{description}</SheetDescription> : null}</SheetHeader><div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>{footer ? <SheetFooter className="border-t px-5 py-3 sm:flex-row sm:justify-end">{footer}</SheetFooter> : null}</SheetContent></Sheet>;
}
