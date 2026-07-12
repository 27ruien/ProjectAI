import type {
  Priority,
  Requirement,
  RequirementStatus,
  RequirementType,
} from "@/types";

interface RequirementSeed {
  projectId: string;
  title: string;
  description: string;
  type: RequirementType;
  priority: Priority;
  source: string;
  owner: string;
  status?: RequirementStatus;
  inOriginalScope?: boolean;
  confidence?: number;
  acceptanceCriteria?: string[];
  nonFunctionalRequirements?: string[];
  conflictsWith?: string[];
  duplicateOf?: string;
}

const seeds: RequirementSeed[] = [
  { projectId: "project-001", title: "支持顾客选择英文或西班牙语互动", description: "互动首屏允许顾客切换英文与西班牙语，后续提示与结果页保持同一语言。", type: "functional", priority: "P0", source: "客户需求确认稿 v1.3", owner: "周逸", acceptanceCriteria: ["首屏提供 EN/ES 切换", "切换后全流程文案一致", "语言选择写入匿名分析事件"] },
  { projectId: "project-001", title: "生成内容需通过品牌安全词校验", description: "任何展示给顾客的 AI 文案与图片描述都必须先经过品牌安全规则。", type: "compliance", priority: "P0", source: "北美法务邮件 2026-07-03", owner: "林夏", acceptanceCriteria: ["命中禁用词时不展示生成内容", "保留校验结果供审计"], nonFunctionalRequirements: ["校验接口 P95 小于 300ms"] },
  { projectId: "project-001", title: "弱网环境提供静态互动兜底", description: "网络连续 5 秒不可用时切换为预置静态问答，不中断顾客流程。", type: "nonFunctional", priority: "P0", source: "技术方案评审纪要", owner: "陈墨", acceptanceCriteria: ["5 秒超时自动降级", "恢复网络后下一轮自动回到在线模式"] },
  { projectId: "project-001", title: "活动数据不得采集人脸特征", description: "仅记录匿名交互步骤、语言和结果类型，不保存人脸图像或生物特征。", type: "compliance", priority: "P0", source: "数据隐私评审记录", owner: "林夏", acceptanceCriteria: ["数据字典不含生物特征字段", "日志中不得出现原始照片"] },
  { projectId: "project-001", title: "门店大屏支持扫码带走结果", description: "结果页展示一次性二维码，顾客扫码后在移动端查看同一结果。", type: "functional", priority: "P1", source: "客户周会纪要 2026-06-25", owner: "周逸", acceptanceCriteria: ["二维码 10 分钟内有效", "过期页面不展示顾客结果"] },
  { projectId: "project-001", title: "运营可配置每日互动主题", description: "门店运营可从已审核主题库中选择当天主题，不允许直接输入自由提示词。", type: "businessRule", priority: "P1", source: "运营工作坊纪要", owner: "周逸", acceptanceCriteria: ["仅展示已审核且在有效期内的主题", "主题切换 5 分钟内生效"] },
  { projectId: "project-001", title: "展示内容需满足 WCAG AA 对比度", description: "所有关键文本、按钮和状态反馈满足 WCAG AA 的视觉对比度要求。", type: "design", priority: "P1", source: "品牌体验规范 v2.1", owner: "何静", acceptanceCriteria: ["自动化对比度检查无阻断项"] },
  { projectId: "project-001", title: "保留每次模型调用审计记录", description: "记录 Model Profile、耗时、Token、Mock 成本和审核结果，不记录密钥。", type: "technicalConstraint", priority: "P1", source: "技术方案 v1.2", owner: "陈墨", acceptanceCriteria: ["审计记录可按 executionId 查询", "日志不包含密钥和顾客隐私数据"] },
  { projectId: "project-002", title: "全球站点共享组件化内容模型", description: "品牌故事、商品卖点和活动模块使用可复用内容结构。", type: "functional", priority: "P0", source: "官网重构 Scope v2.0", owner: "赵琦" },
  { projectId: "project-002", title: "支持中英日三种语言", description: "首期支持简体中文、英语与日语，并允许独立发布各语言内容。", type: "content", priority: "P0", source: "内容迁移清单", owner: "赵琦" },
  { projectId: "project-002", title: "核心页面 LCP 小于 2.5 秒", description: "在目标市场 4G 网络条件下，核心落地页 LCP P75 小于 2.5 秒。", type: "nonFunctional", priority: "P1", source: "前端性能基线", owner: "陈墨" },
  { projectId: "project-002", title: "商品详情接入现有 PIM", description: "商品基础信息、规格与上下架状态由 PIM 单向同步。", type: "integration", priority: "P0", source: "系统集成方案", owner: "梁柯" },
  { projectId: "project-003", title: "会员等级按滚动 12 个月消费计算", description: "每日根据最近 365 天有效消费重算等级，退款金额需扣减。", type: "businessRule", priority: "P0", source: "会员规则确认稿 v3", owner: "林夏" },
  { projectId: "project-003", title: "历史积分迁移需账实一致", description: "迁移前后每个账户的可用、冻结与过期积分总额必须一致。", type: "nonFunctional", priority: "P0", source: "数据迁移验收方案", owner: "徐苏", status: "pendingReview" },
  { projectId: "project-003", title: "权益核销支持门店离线补录", description: "断网门店可暂存核销记录并在恢复后补传，服务端需防重复。", type: "functional", priority: "P1", source: "门店访谈纪要", owner: "梁柯" },
  { projectId: "project-004", title: "同批商品图锁定构图和镜头高度", description: "同一 SKU 批次生成时保持构图、镜头高度和主体比例一致。", type: "functional", priority: "P0", source: "运营灰度反馈", owner: "周逸", status: "pendingReview" },
  { projectId: "project-004", title: "生成失败后自动切换备用模板", description: "质量评分连续两次不达标时，自动使用已审核的备用提示词模板重试。", type: "businessRule", priority: "P1", source: "AI 生成策略 v1.4", owner: "梁柯" },
  { projectId: "project-004", title: "图片需保留生成参数追溯信息", description: "记录模板版本、随机种子、模型档案和审核人。", type: "technicalConstraint", priority: "P1", source: "素材审计要求", owner: "王菡" },
  { projectId: "project-005", title: "H5 首屏资源控制在 450KB 内", description: "不含按需加载媒体，初始关键资源压缩后总量不超过 450KB。", type: "nonFunctional", priority: "P0", source: "海外性能目标", owner: "陈墨" },
  { projectId: "project-005", title: "根据区域选择最近 CDN 节点", description: "通过边缘路由将访问导向延迟最低的合规节点。", type: "technicalConstraint", priority: "P1", source: "CDN 技术方案", owner: "陈墨" },
  { projectId: "project-005", title: "低端安卓设备关闭粒子动效", description: "设备性能评分低于阈值时使用静态背景并关闭粒子动画。", type: "design", priority: "P1", source: "性能复盘会议", owner: "赵琦" },
  { projectId: "project-006", title: "旧款平板启用轻量 AR 模式", description: "GPU 能力不足的旧款设备加载低面数模型并关闭实时阴影。", type: "technicalConstraint", priority: "P0", source: "设备兼容测试报告", owner: "梁柯", status: "pendingReview" },
  { projectId: "project-006", title: "门店可远程查看设备健康状态", description: "区域管理员可查看设备在线、版本、温度与最近错误。", type: "functional", priority: "P1", source: "运维访谈纪要", owner: "王菡" },
  { projectId: "project-006", title: "AR 试穿素材按地区授权过滤", description: "只向门店下发所在地区授权有效的商品素材。", type: "compliance", priority: "P0", source: "素材授权矩阵", owner: "王菡" },
  { projectId: "project-007", title: "销售漏斗统一采用机会创建月归属", description: "跨月成交仍计入机会创建月漏斗，并单独展示回款月。", type: "businessRule", priority: "P0", source: "指标口径工作坊", owner: "秦雅", status: "pendingReview", conflictsWith: ["req-026"] },
  { projectId: "project-007", title: "销售漏斗按回款月归属", description: "财务建议所有收入和转化均按首次回款月份统计。", type: "businessRule", priority: "P0", source: "财务复核邮件", owner: "秦雅", status: "pendingReview", inOriginalScope: false, conflictsWith: ["req-025"] },
  { projectId: "project-007", title: "客户健康度支持指标权重配置", description: "管理员可按客群配置活跃、订单、服务工单等指标权重。", type: "functional", priority: "P1", source: "CRM 产品需求 v1", owner: "秦雅" },
  { projectId: "project-008", title: "素材授权到期前 30 天提醒", description: "平台在授权到期前 30、14、7 天向素材负责人发送站内提醒。", type: "functional", priority: "P0", source: "欧洲市场访谈纪要", owner: "赵琦" },
  { projectId: "project-008", title: "区域团队仅可下载已授权素材", description: "下载时按用户区域、渠道和素材授权范围进行权限过滤。", type: "compliance", priority: "P0", source: "权限规则草案", owner: "秦雅" },
  { projectId: "project-008", title: "同一素材支持地区衍生版本关联", description: "全局母版可关联各地区本地化版本，并展示继承与差异。", type: "functional", priority: "P1", source: "亚太市场访谈纪要", owner: "秦雅", status: "draft" },
];

export const mockRequirements: Requirement[] = seeds.map((seed, index) => {
  const number = String(index + 1).padStart(3, "0");
  const id = `req-${number}`;
  const createdAt = `2026-${index < 12 ? "05" : "06"}-${String((index % 24) + 1).padStart(2, "0")}T10:00:00+08:00`;
  const updatedAt = `2026-07-${String((index % 11) + 1).padStart(2, "0")}T16:30:00+08:00`;
  const status = seed.status ?? "confirmed";
  const citationId = `citation-${String((index % 20) + 1).padStart(3, "0")}`;
  const sourceDocumentId = `doc-${String((index % 15) + 1).padStart(3, "0")}`;

  return {
    id,
    projectId: seed.projectId,
    requirementId: `REQ-${number}`,
    version: status === "draft" ? 1 : 2,
    sourceIds: [sourceDocumentId],
    title: seed.title,
    description: seed.description,
    type: seed.type,
    source: seed.source,
    priority: seed.priority,
    status,
    inOriginalScope: seed.inOriginalScope ?? index < 24,
    owner: seed.owner,
    acceptanceStatus: status === "confirmed" ? "accepted" : "pending",
    acceptanceCriteria: seed.acceptanceCriteria ?? ["在业务验收环境按描述完成验证", "相关异常状态有明确反馈"],
    aiUnderstanding: `AI 判断该需求关注“${seed.title}”，建议在评审时确认边界条件与验收数据口径。`,
    originalQuote: seed.description,
    exceptionStates: ["依赖服务不可用时展示可恢复提示", "权限不足时不暴露受限信息"],
    nonFunctionalRequirements: seed.nonFunctionalRequirements ?? [],
    relatedPageIds: [],
    relatedTaskIds: [],
    relatedScopeIds: seed.projectId === "project-001" ? ["scope-004"] : [],
    citationIds: [citationId],
    confidence: seed.confidence ?? Math.max(0.79, 0.96 - (index % 7) * 0.025),
    reviewStatus: status === "confirmed" ? "approved" : "pendingReview",
    duplicateOf: seed.duplicateOf,
    conflictsWith: seed.conflictsWith ?? [],
    history: [
      {
        id: `${id}-history-001`,
        projectId: seed.projectId,
        requirementId: id,
        revision: 1,
        version: 1,
        sourceIds: [sourceDocumentId],
        changedBy: "AI 助手",
        changeType: "created",
        changeSummary: "从项目资料中提取为 AI 草稿。",
        nextValue: { title: seed.title, status: "draft" },
        createdAt,
        updatedAt: createdAt,
        createdBy: "AI 助手",
      },
    ],
    createdAt,
    updatedAt,
    createdBy: "AI 助手",
  };
});

export const mockRequirementHistories = mockRequirements.flatMap(
  (requirement) => requirement.history,
);
