import type {
  KnowledgeChunk,
  KnowledgeFact,
  KnowledgeLayer,
  ProjectDocument,
  ProjectDocumentStatus,
  ProjectDocumentType,
  SourceCitation,
} from "@/types";

interface DocumentSeed {
  projectId: string;
  name: string;
  fileName: string;
  documentType: ProjectDocumentType;
  category: string;
  status: ProjectDocumentStatus;
  sourceDate: string;
  summary: string;
  facts: string[];
  isEffective?: boolean;
  versionLabel?: string;
}

const documentSeeds: DocumentSeed[] = [
  { projectId: "project-001", name: "北美旗舰店项目 Scope v1.3", fileName: "NA-Flagship-Scope-v1.3.pdf", documentType: "scope", category: "正式 Scope", status: "confirmed", sourceDate: "2026-07-10", summary: "当前有效 Scope，新增西班牙语流程与弱网静态兜底。", facts: ["上线日期为 2026 年 8 月 28 日", "首期门店为纽约第五大道旗舰店", "弱网超过 5 秒进入静态模式"], versionLabel: "v1.3" },
  { projectId: "project-001", name: "客户需求确认稿 v1.3", fileName: "客户需求确认稿-v1.3.docx", documentType: "clientRequirement", category: "客户需求", status: "confirmed", sourceDate: "2026-07-08", summary: "客户确认首期互动流程、语言、扫码带走结果和运营主题配置。", facts: ["支持英文和西班牙语", "二维码有效期为 10 分钟", "主题只能从审核库选择"], versionLabel: "v1.3" },
  { projectId: "project-001", name: "7 月 8 日客户周会纪要", fileName: "2026-07-08-客户周会纪要.md", documentType: "meetingMinutes", category: "会议纪要", status: "aiParsed", sourceDate: "2026-07-08", summary: "确认上线窗口不变，素材授权最晚 7 月 18 日完成。", facts: ["上线窗口保持 8 月 28 日", "授权清单负责人为客户品牌团队", "西班牙语文案由北美市场复核"] },
  { projectId: "project-002", name: "品牌官网 Scope v2.0", fileName: "Brand-Web-Scope-v2.0.pdf", documentType: "scope", category: "正式 Scope", status: "confirmed", sourceDate: "2026-06-28", summary: "覆盖设计系统、核心页面、多语言和 PIM 集成。", facts: ["首期支持中英日", "商品数据来自 PIM"] },
  { projectId: "project-002", name: "官网内容迁移清单", fileName: "官网内容迁移清单.xlsx", documentType: "schedule", category: "项目排期", status: "aiParsed", sourceDate: "2026-07-09", summary: "当前已完成 62% 内容迁移，日语商品故事进度最低。", facts: ["内容迁移目标日期为 8 月 20 日"] },
  { projectId: "project-003", name: "会员规则确认稿 v3", fileName: "会员规则确认稿-v3.pdf", documentType: "clientRequirement", category: "客户需求", status: "confirmed", sourceDate: "2026-06-18", summary: "确认滚动等级、积分有效期和权益核销规则。", facts: ["会员等级按最近 365 天消费计算", "退款需扣减等级消费额"] },
  { projectId: "project-003", name: "积分迁移第二轮报告", fileName: "积分迁移演练-R2.xlsx", documentType: "testReport", category: "测试报告", status: "pendingConfirmation", sourceDate: "2026-07-11", summary: "抽样发现 0.7% 账户余额差异，主要来自冻结积分状态映射。", facts: ["差异账户比例为 0.7%", "冻结积分映射需修正"] },
  { projectId: "project-004", name: "商品图灰度运营反馈", fileName: "商品图灰度反馈-0710.docx", documentType: "clientFeedback", category: "客户反馈", status: "aiParsed", sourceDate: "2026-07-10", summary: "同批商品图的镜头高度不一致是当前主要返工原因。", facts: ["服饰类返工率为 12%", "运营要求锁定构图"] },
  { projectId: "project-005", name: "海外 H5 第二轮压测报告", fileName: "Global-H5-Perf-R2.pdf", documentType: "testReport", category: "测试报告", status: "aiParsed", sourceDate: "2026-07-12", summary: "北美和东南亚达标，巴西 P75 LCP 为 2.9 秒。", facts: ["巴西 LCP P75 为 2.9 秒", "首屏资源为 438KB"] },
  { projectId: "project-006", name: "门店设备兼容测试报告", fileName: "AR-Device-Compatibility-R1.pdf", documentType: "testReport", category: "测试报告", status: "pendingConfirmation", sourceDate: "2026-07-09", summary: "旧款平板在实时阴影场景平均帧率仅 22 FPS。", facts: ["25% 门店仍使用旧款平板", "关闭实时阴影后可达 31 FPS"] },
  { projectId: "project-006", name: "AR 素材授权矩阵", fileName: "AR-Asset-License-Matrix.xlsx", documentType: "contract", category: "合同与授权", status: "confirmed", sourceDate: "2026-07-02", summary: "记录商品素材按国家、渠道和日期的使用授权。", facts: ["北美与欧盟素材授权范围不同"] },
  { projectId: "project-007", name: "CRM 指标口径工作坊纪要", fileName: "CRM-Metric-Workshop.md", documentType: "meetingMinutes", category: "会议纪要", status: "pendingConfirmation", sourceDate: "2026-07-07", summary: "销售与财务对销售额归属月份仍存在分歧。", facts: ["销售建议按机会创建月", "财务建议按回款月"] },
  { projectId: "project-007", name: "CRM 数据字典 v0.8", fileName: "CRM-Data-Dictionary-v0.8.xlsx", documentType: "technicalSolution", category: "技术方案", status: "aiParsed", sourceDate: "2026-07-05", summary: "初版事实表、维度和刷新频率定义。", facts: ["销售事实表每日 6 点刷新"] },
  { projectId: "project-008", name: "全球素材权限规则草案", fileName: "DAM-Permission-Draft-v0.4.docx", documentType: "technicalSolution", category: "权限规则", status: "pendingConfirmation", sourceDate: "2026-07-06", summary: "按区域、品牌、渠道和授权期控制素材查看与下载。", facts: ["下载权限必须同时满足区域和授权期"] },
  { projectId: "project-008", name: "区域市场访谈纪要合集", fileName: "Regional-Marketing-Interviews.pdf", documentType: "meetingMinutes", category: "会议纪要", status: "aiParsed", sourceDate: "2026-07-08", summary: "欧洲关注授权到期，亚太关注地区衍生版本关联。", facts: ["授权到期提醒是欧洲团队最高优先级", "地区衍生版本需关联全球母版"] },
];

export const mockProjectDocuments: ProjectDocument[] = documentSeeds.map(
  (seed, index) => {
    const number = String(index + 1).padStart(3, "0");
    const id = `doc-${number}`;
    const versionLabel = seed.versionLabel ?? "v1.0";
    const versionId = `${id}-version-${versionLabel.replace(".", "-")}`;
    const createdAt = `${seed.sourceDate}T09:30:00+08:00`;

    return {
      id,
      projectId: seed.projectId,
      version: 1,
      sourceIds: [versionId],
      name: seed.name,
      fileName: seed.fileName,
      documentType: seed.documentType,
      category: seed.category,
      folderPath: `/${seed.category}`,
      status: seed.status,
      parseStatus: seed.status === "original" ? "waiting" : "parsed",
      permissionScope: "projectTeam",
      summary: seed.summary,
      aiExtractedFacts: seed.facts,
      currentVersionId: versionId,
      versions: [
        {
          id: versionId,
          projectId: seed.projectId,
          documentId: id,
          version: 1,
          versionLabel,
          sourceIds: [],
          fileName: seed.fileName,
          fileSize: 284_000 + index * 47_500,
          mimeType: seed.fileName.endsWith(".xlsx")
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : seed.fileName.endsWith(".docx")
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : seed.fileName.endsWith(".md")
                ? "text/markdown"
                : "application/pdf",
          storageKey: `mock/${seed.projectId}/${seed.fileName}`,
          status: seed.status,
          parseStatus: "parsed",
          uploadedBy: index % 3 === 0 ? "林夏" : index % 3 === 1 ? "赵琦" : "王菡",
          uploadedAt: createdAt,
          effectiveFrom: seed.status === "confirmed" ? seed.sourceDate : undefined,
          isCurrent: true,
          createdAt,
          updatedAt: createdAt,
          createdBy: index % 3 === 0 ? "林夏" : index % 3 === 1 ? "赵琦" : "王菡",
        },
      ],
      isEffective: seed.isEffective ?? seed.status === "confirmed",
      sourceDate: seed.sourceDate,
      relatedRequirementIds: [],
      relatedScopeIds: seed.documentType === "scope" ? [seed.projectId === "project-001" ? "scope-004" : "scope-project-002-v2"] : [],
      relatedActionIds: [],
      relatedMeetingIds: seed.documentType === "meetingMinutes" ? [`meeting-${number}`] : [],
      relatedRiskIds: [],
      tags: [seed.category, seed.documentType],
      createdAt,
      updatedAt: createdAt,
      createdBy: index % 3 === 0 ? "林夏" : index % 3 === 1 ? "赵琦" : "王菡",
    };
  },
);

interface CitationSeed {
  documentIndex: number;
  section: string;
  pageNumber?: number;
  text: string;
  layer: KnowledgeLayer;
  keywords: string[];
}

const citationSeeds: CitationSeed[] = [
  { documentIndex: 0, section: "3.2 交付范围", pageNumber: 8, text: "互动体验首期支持英语与西班牙语，语言选择应贯穿完整互动流程。", layer: "scope", keywords: ["Scope", "西班牙语", "语言"] },
  { documentIndex: 0, section: "6.1 项目里程碑", pageNumber: 17, text: "门店正式上线目标日期为 2026 年 8 月 28 日，验收窗口为上线前十个工作日。", layer: "scope", keywords: ["上线日期", "里程碑", "验收"] },
  { documentIndex: 1, section: "2.4 弱网体验", pageNumber: 6, text: "网络请求连续五秒未返回时进入静态互动模式，不能让顾客停留在空白页面。", layer: "requirement", keywords: ["弱网", "静态模式", "超时"] },
  { documentIndex: 1, section: "4.3 结果分享", pageNumber: 11, text: "结果二维码有效期为十分钟，过期后仅展示活动首页，不再返回个人结果。", layer: "requirement", keywords: ["二维码", "结果", "有效期"] },
  { documentIndex: 2, section: "客户确认事项", pageNumber: 2, text: "客户确认上线窗口保持 8 月 28 日不变，素材授权清单最晚于 7 月 18 日交付。", layer: "meetingDecision", keywords: ["客户确认", "上线", "素材授权"] },
  { documentIndex: 2, section: "待办事项", pageNumber: 3, text: "北美市场团队负责在 7 月 15 日前完成西班牙语文案复核。", layer: "actionPlan", keywords: ["Action", "西班牙语", "复核"] },
  { documentIndex: 3, section: "2.1 站点范围", pageNumber: 5, text: "首期站点提供简体中文、英语和日语三个独立发布通道。", layer: "scope", keywords: ["多语言", "官网", "发布"] },
  { documentIndex: 4, section: "迁移进度", text: "截至 7 月 9 日，总体内容迁移完成 62%，日语商品故事完成 41%。", layer: "actionPlan", keywords: ["内容迁移", "日语", "进度"] },
  { documentIndex: 5, section: "等级计算规则", pageNumber: 9, text: "会员等级每日按最近 365 天有效消费计算，退款金额在退款完成后扣减。", layer: "confirmedFact", keywords: ["会员等级", "365天", "退款"] },
  { documentIndex: 6, section: "差异结果", text: "第二轮迁移抽样发现 0.7% 账户存在余额差异，集中在冻结积分状态映射。", layer: "risk", keywords: ["迁移", "积分", "风险"] },
  { documentIndex: 7, section: "主要反馈", pageNumber: 4, text: "服饰类商品图返工率为 12%，最常见问题是同批图片镜头高度不一致。", layer: "requirement", keywords: ["商品图", "返工", "构图"] },
  { documentIndex: 8, section: "区域测试结果", pageNumber: 7, text: "巴西节点 LCP P75 为 2.9 秒，尚未达到 2.5 秒目标；北美和东南亚均已达标。", layer: "risk", keywords: ["H5", "LCP", "巴西"] },
  { documentIndex: 9, section: "旧款设备结果", pageNumber: 12, text: "旧款平板开启实时阴影时平均 22 FPS，关闭后可稳定在 31 FPS。", layer: "risk", keywords: ["AR", "旧款平板", "帧率"] },
  { documentIndex: 10, section: "区域授权", text: "AR 商品素材必须根据门店所在国家过滤，北美许可不自动覆盖欧盟地区。", layer: "confirmedFact", keywords: ["素材授权", "区域", "合规"] },
  { documentIndex: 11, section: "争议口径", pageNumber: 5, text: "销售建议按机会创建月归属，财务建议按首次回款月归属，会议未形成最终决策。", layer: "meetingDecision", keywords: ["CRM", "销售额", "口径冲突"] },
  { documentIndex: 12, section: "刷新策略", text: "销售事实表每日北京时间 06:00 完成 T+1 刷新，失败时保留前一日快照。", layer: "confirmedFact", keywords: ["数据刷新", "CRM", "快照"] },
  { documentIndex: 13, section: "下载策略", pageNumber: 8, text: "用户只有在所属区域、目标渠道和授权有效期均匹配时才可下载原始素材。", layer: "requirement", keywords: ["权限", "下载", "素材"] },
  { documentIndex: 14, section: "欧洲市场反馈", pageNumber: 6, text: "授权到期提醒应分别在到期前 30 天、14 天和 7 天触发。", layer: "requirement", keywords: ["授权到期", "提醒", "欧洲"] },
  { documentIndex: 14, section: "亚太市场反馈", pageNumber: 13, text: "各地区希望在保留全球母版关系的同时管理本地化衍生版本。", layer: "requirement", keywords: ["母版", "本地化", "版本"] },
  { documentIndex: 0, section: "7.2 范围外事项", pageNumber: 20, text: "首期不包含顾客人脸识别、会员身份匹配与自动向客户发送营销邮件。", layer: "scope", keywords: ["范围外", "人脸识别", "邮件"] },
];

export const mockSourceCitations: SourceCitation[] = citationSeeds.map(
  (seed, index) => {
    const document = mockProjectDocuments[seed.documentIndex];
    const number = String(index + 1).padStart(3, "0");
    return {
      id: `citation-${number}`,
      projectId: document.projectId,
      documentId: document.id,
      chunkId: `chunk-${number}`,
      documentName: document.name,
      documentType: document.documentType,
      section: seed.section,
      pageNumber: seed.pageNumber,
      version: document.versions[0].versionLabel,
      sourceDate: document.sourceDate,
      effectiveFrom: document.versions[0].effectiveFrom,
      trustLevel: document.status === "confirmed" ? "verified" : "high",
      permissionScope: document.permissionScope,
      sourceStatus: document.status,
      isEffective: document.isEffective,
      citationText: seed.text,
      url: `/projects/${document.projectId}/documents?document=${document.id}`,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      createdBy: "AI 助手",
    };
  },
);

export const mockKnowledgeChunks: KnowledgeChunk[] = citationSeeds.map(
  (seed, index) => {
    const citation = mockSourceCitations[index];
    return {
      id: citation.chunkId,
      chunkId: citation.chunkId,
      projectId: citation.projectId,
      documentId: citation.documentId,
      documentType: citation.documentType,
      layer: seed.layer,
      content: seed.text,
      section: citation.section,
      pageNumber: citation.pageNumber,
      version: 1,
      versionLabel: citation.version,
      sourceDate: citation.sourceDate,
      effectiveFrom: citation.effectiveFrom,
      trustLevel: citation.trustLevel,
      permissionScope: citation.permissionScope,
      status: citation.isEffective ? "active" : "pending",
      citationText: citation.citationText,
      keywords: seed.keywords,
      sourceIds: [citation.id],
      createdAt: citation.createdAt,
      updatedAt: citation.updatedAt,
      createdBy: "AI 助手",
    };
  },
);

export const mockKnowledgeFacts: KnowledgeFact[] = [
  { id: "fact-001", projectId: "project-001", layer: "confirmedFact", title: "目标上线日期", value: "2026 年 8 月 28 日", status: "confirmed", trustLevel: "verified", effectiveFrom: "2026-07-10", citationIds: ["citation-002", "citation-005"], version: 3, sourceIds: ["doc-001", "doc-003"], createdAt: "2026-07-10T09:00:00+08:00", updatedAt: "2026-07-10T09:00:00+08:00", createdBy: "林夏" },
  { id: "fact-002", projectId: "project-001", layer: "scope", title: "当前有效 Scope", value: "北美旗舰店项目 Scope v1.3", status: "confirmed", trustLevel: "verified", effectiveFrom: "2026-07-10", citationIds: ["citation-001", "citation-020"], version: 4, sourceIds: ["doc-001"], createdAt: "2026-07-10T09:00:00+08:00", updatedAt: "2026-07-10T09:00:00+08:00", createdBy: "林夏" },
  { id: "fact-003", projectId: "project-001", layer: "risk", title: "素材授权风险", value: "授权清单最晚 7 月 18 日交付，当前仍有 12 项待确认。", status: "confirmed", trustLevel: "high", citationIds: ["citation-005"], version: 2, sourceIds: ["doc-003"], createdAt: "2026-07-08T18:00:00+08:00", updatedAt: "2026-07-11T18:00:00+08:00", createdBy: "AI 助手" },
  { id: "fact-004", projectId: "project-001", layer: "meetingDecision", title: "语言范围", value: "首期支持英语和西班牙语。", status: "confirmed", trustLevel: "verified", citationIds: ["citation-001"], version: 2, sourceIds: ["doc-001", "doc-002"], createdAt: "2026-07-08T18:00:00+08:00", updatedAt: "2026-07-10T09:00:00+08:00", createdBy: "林夏" },
  { id: "fact-005", projectId: "project-007", layer: "meetingDecision", title: "销售额归属口径", value: "按机会创建月或首次回款月尚未决策。", status: "pending", trustLevel: "high", citationIds: ["citation-015"], version: 1, sourceIds: ["doc-012"], createdAt: "2026-07-07T17:00:00+08:00", updatedAt: "2026-07-07T17:00:00+08:00", createdBy: "AI 助手" },
];

export const mockDocumentVersions = mockProjectDocuments.flatMap(
  (document) => document.versions,
);
