"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "info";
type ToastItem = { id: number; message: string; tone: ToastTone };
type ToastContextValue = { toast: (message: string, tone?: ToastTone) => void };
const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback((message: string, tone: ToastTone = "success") => {
    const id = Date.now();
    setItems((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 3200);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return <ToastContext.Provider value={value}>{children}<div className="fixed bottom-5 right-5 z-[80] flex w-[min(360px,calc(100vw-40px))] flex-col gap-2" aria-live="polite">{items.map((item) => <div key={item.id} className={cn("flex items-center gap-2 rounded-xl border bg-card px-3.5 py-3 text-sm shadow-[var(--shadow-float)]", item.tone === "success" ? "text-success" : "text-info")}>{item.tone === "success" ? <CheckCircle2 className="size-4" /> : <Info className="size-4" />}<span className="flex-1 text-foreground">{item.message}</span><button onClick={() => setItems((current) => current.filter((toastItem) => toastItem.id !== item.id))} aria-label="关闭提示" className="rounded p-1 text-muted-foreground hover:bg-muted"><X className="size-3.5" /></button></div>)}</div></ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
