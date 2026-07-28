"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "info" | "error";
type ToastAction = {
  label: string;
  onClick: () => void;
};
type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
};
type ToastContextValue = {
  toast: (
    message: string,
    tone?: ToastTone,
    action?: ToastAction,
  ) => void;
};
const ToastContext = createContext<ToastContextValue>({ toast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const toast = useCallback(
    (
      message: string,
      tone: ToastTone = "success",
      action?: ToastAction,
    ) => {
      const id = Date.now() + Math.random();
      setItems((current) => [...current.slice(-2), { id, message, tone, action }]);
      window.setTimeout(() => dismiss(id), action ? 8_000 : 3_200);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-[80] flex w-[min(400px,calc(100vw-40px))] flex-col gap-2"
        aria-live="polite"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-start gap-2 rounded-xl border bg-card px-3.5 py-3 text-sm shadow-[var(--shadow-float)]",
              item.tone === "success"
                ? "border-success/25 text-success"
                : item.tone === "error"
                  ? "border-danger/25 text-danger"
                  : "border-info/25 text-info",
            )}
          >
            {item.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            ) : item.tone === "error" ? (
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-foreground">{item.message}</p>
              {item.action ? (
                <button
                  type="button"
                  onClick={() => {
                    dismiss(item.id);
                    item.action?.onClick();
                  }}
                  className="mt-2 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {item.action.label}
                </button>
              ) : null}
            </div>
            <button
              onClick={() => dismiss(item.id)}
              aria-label="关闭提示"
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
