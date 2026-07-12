"use client";

import { Cpu, ExternalLink } from "lucide-react";

export function ModelProfileBadge({ profileId, interactive = false, onClick }: { profileId: string; interactive?: boolean; onClick?: () => void }) {
  const className = "inline-flex items-center gap-1.5 rounded-md border border-primary/15 bg-primary/[0.055] px-2 py-1 text-[10px] font-medium text-primary";
  if (interactive) return <button type="button" onClick={onClick} className={`${className} hover:border-primary/35`}><Cpu className="size-3" />{profileId}<ExternalLink className="size-2.5 opacity-60" /></button>;
  return <span className={className}><Cpu className="size-3" />{profileId}</span>;
}

