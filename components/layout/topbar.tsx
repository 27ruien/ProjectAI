"use client";

import { Check, Menu, Monitor, Moon, Sun } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { EnvironmentBadge } from "./environment-banner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator as MenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppearance, type Appearance } from "@/components/theme-provider";

const appearanceOptions: Array<{ value: Appearance; label: string; icon: typeof Sun }> = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

export function Topbar({ currentProject, currentPath, onMenuOpen }: { currentProject?: AuthorizedProjectSummary; currentPath: string; onMenuOpen: () => void }) {
  const { appearance, resolvedAppearance, setAppearance } = useAppearance();
  void currentProject;
  void currentPath;

  return (
    <div className="flex h-full min-w-0 items-center justify-end gap-2 px-3 sm:px-5 lg:px-6">
      <Button variant="ghost" size="icon" onClick={onMenuOpen} aria-label="打开导航" className="lg:hidden"><Menu /></Button>
      <span className="flex-1" />
      <EnvironmentBadge />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`外观：${appearance}`} title="切换外观">
            {resolvedAppearance === "dark" ? <Moon /> : <Sun />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel>外观</DropdownMenuLabel>
          <MenuSeparator />
          {appearanceOptions.map(({ value, label, icon: Icon }) => (
            <DropdownMenuItem key={value} onSelect={() => setAppearance(value)}>
              <Icon />{label}{appearance === value ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
