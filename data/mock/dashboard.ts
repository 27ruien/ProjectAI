export interface DashboardMetric {
  id: string;
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "flat";
}

export interface DashboardTodo {
  id: string;
  title: string;
  projectId: string;
  dueDate: string;
  completed: boolean;
  priority: "P0" | "P1" | "P2" | "P3";
}

export const mockDashboardMetrics: DashboardMetric[] = [
  { id: "metric-active", label: "进行中项目", value: "7", change: "较上月 +1", trend: "up" },
  { id: "metric-review", label: "待审核 AI 产出", value: "6", change: "今日新增 2", trend: "up" },
  { id: "metric-overdue", label: "即将到期 Action", value: "9", change: "其中 2 项已逾期", trend: "down" },
  { id: "metric-risk", label: "高风险项目", value: "3", change: "1 项风险升级", trend: "down" },
  { id: "metric-hours", label: "AI 节省工时", value: "126h", change: "本月 +18%", trend: "up" },
  { id: "metric-calls", label: "AI 调用次数", value: "1,842", change: "成功率 96.8%", trend: "up" },
];

export const mockDashboardTodos: DashboardTodo[] = [
  { id: "todo-001", title: "审核北美旗舰店需求提取结果", projectId: "project-001", dueDate: "2026-07-12", completed: false, priority: "P0" },
  { id: "todo-002", title: "确认 CRM 销售额归属口径会议时间", projectId: "project-007", dueDate: "2026-07-13", completed: false, priority: "P0" },
  { id: "todo-003", title: "跟进会员积分迁移差异修复", projectId: "project-003", dueDate: "2026-07-14", completed: false, priority: "P0" },
  { id: "todo-004", title: "复核品牌官网日语内容进度", projectId: "project-002", dueDate: "2026-07-15", completed: true, priority: "P1" },
];

export const mockAIUsageTrend = [
  { date: "07-06", calls: 186, hoursSaved: 14 },
  { date: "07-07", calls: 224, hoursSaved: 17 },
  { date: "07-08", calls: 278, hoursSaved: 21 },
  { date: "07-09", calls: 241, hoursSaved: 18 },
  { date: "07-10", calls: 302, hoursSaved: 23 },
  { date: "07-11", calls: 287, hoursSaved: 20 },
  { date: "07-12", calls: 324, hoursSaved: 25 },
];
