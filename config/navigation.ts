export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon: string;
  children?: NavigationItem[];
}

export const primaryNavigation: NavigationItem[] = [
  { id: "dashboard", label: "工作台", href: "/dashboard", icon: "LayoutDashboard" },
  { id: "projects", label: "项目", href: "/projects", icon: "FolderKanban" },
  { id: "workflows", label: "AI 工作流", href: "/workflows", icon: "Workflow" },
  { id: "reviews", label: "审核中心", href: "/reviews", icon: "ClipboardCheck" },
  { id: "skills", label: "Skills", href: "/skills", icon: "Blocks" },
  { id: "knowledge", label: "知识与资产", href: "/knowledge", icon: "Library" },
  { id: "analytics", label: "数据看板", href: "/analytics", icon: "ChartNoAxesCombined" },
  {
    id: "settings",
    label: "系统设置",
    href: "/settings",
    icon: "Settings",
    children: [
      { id: "ai-models", label: "AI 模型管理", href: "/settings/ai-models", icon: "Cpu" },
      { id: "permissions", label: "权限管理", href: "/settings/permissions", icon: "ShieldCheck" },
      { id: "notifications", label: "通知设置", href: "/settings/notifications", icon: "Bell" },
      { id: "logs", label: "系统日志", href: "/settings/logs", icon: "ScrollText" },
    ],
  },
];

export const projectNavigation = [
  { id: "overview", label: "项目概览", segment: "overview" },
  { id: "documents", label: "项目资料", segment: "documents" },
  { id: "knowledge", label: "项目知识", segment: "knowledge" },
  { id: "requirements", label: "需求中心", segment: "requirements" },
  { id: "scope", label: "Scope 管理", segment: "scope" },
  { id: "actions", label: "Action Plan", segment: "actions" },
  { id: "meetings", label: "会议与决策", segment: "meetings" },
  { id: "risks", label: "风险与状态", segment: "risks" },
] as const;
