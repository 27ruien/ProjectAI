"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { notifications } from "@mantine/notifications";

type ToastTone = "success" | "info";
type ToastContextValue = { toast: (message: string, tone?: ToastTone) => void };
const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const toast = useCallback((message: string, tone: ToastTone = "success") => {
    notifications.show({
      message,
      color: tone === "success" ? "green" : "projectBlue",
      title: tone === "success" ? "操作成功" : "提示",
    });
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
