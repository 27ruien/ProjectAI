import { Search } from "lucide-react";
import type { ReactNode } from "react";

export function FilterBar({ value, onChange, placeholder = "搜索…", children, trailing }: { value: string; onChange: (value: string) => void; placeholder?: string; children?: ReactNode; trailing?: ReactNode }) {
  return <div className="flex flex-col gap-2 border-b bg-surface/70 p-3 sm:flex-row sm:items-center"><label className="relative min-w-52 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">搜索</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 w-full rounded-lg border bg-card pl-8 pr-3 text-xs placeholder:text-muted-foreground focus:border-primary" /></label><div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>{trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}</div>;
}
