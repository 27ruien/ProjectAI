"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Appearance = "system" | "light" | "dark";

type AppearanceContextValue = {
  appearance: Appearance;
  resolvedAppearance: "light" | "dark";
  setAppearance: (appearance: Appearance) => void;
};

const STORAGE_KEY = "projectai-appearance";
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function systemAppearance(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>("system");
  const [resolvedAppearance, setResolvedAppearance] = useState<"light" | "dark">(
    "light",
  );

  const apply = useCallback((next: Appearance) => {
    const resolved = next === "system" ? systemAppearance() : next;
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.dataset.appearance = next;
    setResolvedAppearance(resolved);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: Appearance =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";
    const frame = window.requestAnimationFrame(() => {
      setAppearanceState(initial);
      apply(initial);
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((window.localStorage.getItem(STORAGE_KEY) ?? "system") === "system")
        apply("system");
    };
    media.addEventListener("change", onChange);
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", onChange);
    };
  }, [apply]);

  const setAppearance = useCallback(
    (next: Appearance) => {
      window.localStorage.setItem(STORAGE_KEY, next);
      setAppearanceState(next);
      apply(next);
    },
    [apply],
  );

  const value = useMemo(
    () => ({ appearance, resolvedAppearance, setAppearance }),
    [appearance, resolvedAppearance, setAppearance],
  );
  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value)
    throw new Error("useAppearance must be used inside AppearanceProvider");
  return value;
}
