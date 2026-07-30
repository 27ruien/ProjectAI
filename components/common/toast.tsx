"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { toast as sonnerToast } from "sonner";

type ToastTone = "success" | "info";
type ToastContextValue = { toast: (message: string, tone?: ToastTone) => void };
const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const toast = useCallback((message: string, tone: ToastTone = "success") => {
    if (tone === "success") sonnerToast.success(message);
    else sonnerToast.info(message);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
