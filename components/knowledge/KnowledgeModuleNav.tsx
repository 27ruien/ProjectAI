"use client";

import Link from "next/link";
import { Files, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

export type DataSpaceArea = "projects" | "company";

const areas = [
  { id: "projects" as const, label: "项目资料", href: "/data-spaces/projects", icon: FolderKanban },
  { id: "company" as const, label: "公司资料", href: "/data-spaces/company", icon: Files },
];

export function KnowledgeModuleNav({ activeArea }: { activeArea: DataSpaceArea }) {
  return (
    <section className="border-b bg-card" data-testid="knowledge-module-nav">
      <div className="px-5 pt-5 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">资料空间</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
            在这里维护项目与公司资料；AI 助手会依据你的权限自动读取相关上下文。
          </p>
        </div>
        <nav className="mt-5 flex gap-1 overflow-x-auto" aria-label="资料空间导航">
          {areas.map((area) => {
            const Icon = area.icon;
            return (
              <Link
                key={area.id}
                href={area.href}
                className={cn(
                  "relative inline-flex items-center gap-2 whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors",
                  activeArea === area.id
                    ? "text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {area.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
