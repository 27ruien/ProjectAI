"use client";

import Link from "next/link";
import { Files, FolderKanban, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

export type KnowledgeArea = "projects" | "templates" | "sessions";

const areas = [
  { id: "projects" as const, label: "项目", href: "/knowledge/projects", icon: FolderKanban },
  { id: "templates" as const, label: "常规模板", href: "/knowledge/templates", icon: Files },
  { id: "sessions" as const, label: "会话", href: "/knowledge/sessions", icon: MessagesSquare },
];

export function KnowledgeModuleNav({ activeArea }: { activeArea: KnowledgeArea }) {
  return (
    <section className="border-b bg-card" data-testid="knowledge-module-nav">
      <div className="px-5 pt-5 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">知识库</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
            维护项目与常规模板，并在会话中基于已授权资料完成问答和文档生成。
          </p>
        </div>
        <nav className="mt-5 flex gap-1 overflow-x-auto" aria-label="知识库导航">
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
