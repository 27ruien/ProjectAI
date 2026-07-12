import { Badge, type BadgeTone } from "./badge";

const projectStatuses: Record<string, { label: string; tone: BadgeTone }> = {
  planning: { label: "规划中", tone: "info" }, active: { label: "进行中", tone: "success" }, paused: { label: "已暂停", tone: "warning" }, completed: { label: "已完成", tone: "neutral" }, archived: { label: "已归档", tone: "neutral" }, atRisk: { label: "有风险", tone: "danger" },
  "进行中": { label: "进行中", tone: "success" }, "规划中": { label: "规划中", tone: "info" }, "已暂停": { label: "已暂停", tone: "warning" }, "已完成": { label: "已完成", tone: "neutral" },
};
const riskLevels: Record<string, { label: string; tone: BadgeTone }> = {
  low: { label: "低", tone: "success" }, medium: { label: "中", tone: "warning" }, high: { label: "高", tone: "danger" }, critical: { label: "严重", tone: "danger" }, normal: { label: "正常", tone: "success" }, attention: { label: "关注", tone: "warning" }, risk: { label: "风险", tone: "danger" }, severe: { label: "严重风险", tone: "danger" },
  "正常": { label: "正常", tone: "success" }, "关注": { label: "关注", tone: "warning" }, "风险": { label: "风险", tone: "danger" }, "严重风险": { label: "严重风险", tone: "danger" },
};

export function ProjectStatusBadge({ status }: { status: string }) { const config = projectStatuses[status] ?? { label: status, tone: "neutral" as BadgeTone }; return <Badge tone={config.tone}>{config.label}</Badge>; }
export function RiskBadge({ level }: { level: string }) { const config = riskLevels[level] ?? { label: level, tone: "neutral" as BadgeTone }; return <Badge tone={config.tone}>{config.label}</Badge>; }
