import { Bot, Boxes } from "lucide-react";
import { Badge } from "./badge";
export function ModelProfileBadge({ profileId }: { profileId: string }) { return <Badge tone="primary"><Bot className="mr-1 size-3" />{profileId}</Badge>; }
export function SkillBadge({ skillId }: { skillId: string }) { return <Badge tone="info"><Boxes className="mr-1 size-3" />{skillId}</Badge>; }
