import type {
  TimelineMakerRequirement,
  TimelineMakerRequirementDomain,
  TimelineMakerTask,
} from "./contracts";

export type TimelineMakerFeature =
  | "campaign_event"
  | "reward"
  | "coupon"
  | "personal_information"
  | "third_party_sharing"
  | "photo_face_biometric"
  | "visual_design"
  | "development"
  | "third_party_integration"
  | "web_hosting"
  | "launch"
  | "hardware";

export type TimelineMakerRequirementCatalogItem = {
  id: string;
  domain: TimelineMakerRequirementDomain;
  label: string;
  features: TimelineMakerFeature[];
  why: string;
};

export const TIMELINE_MAKER_REQUIREMENT_CATALOG: readonly TimelineMakerRequirementCatalogItem[] = [
  { id: "activity-rules", domain: "campaign_event", label: "Activity Rules", features: ["campaign_event"], why: "活动任务依赖可执行且已确认的活动规则" },
  { id: "activity-dates", domain: "campaign_event", label: "Start / End Date", features: ["campaign_event"], why: "活动排期需要明确开始和结束边界" },
  { id: "participation-rules", domain: "campaign_event", label: "Participation Rules", features: ["campaign_event"], why: "参与流程和资格校验依赖参与规则" },
  { id: "eligibility", domain: "campaign_event", label: "Eligibility", features: ["campaign_event"], why: "活动必须明确适用人群或资格条件" },
  { id: "reward-rules", domain: "campaign_event", label: "Reward Rules", features: ["reward"], why: "奖励发放与验证依赖明确规则" },
  { id: "coupon-rules", domain: "campaign_event", label: "Coupon Rules", features: ["coupon"], why: "优惠券生成、领取和核销依赖券规则" },
  { id: "claim-redemption-rules", domain: "campaign_event", label: "Claim / Redemption Rules", features: ["reward", "coupon"], why: "领取或核销流程必须有明确边界" },

  { id: "privacy-policy", domain: "personal_information", label: "Privacy Policy", features: ["personal_information"], why: "个人信息采集前需要明确隐私材料状态" },
  { id: "personal-data-consent", domain: "personal_information", label: "Consent", features: ["personal_information"], why: "个人信息处理需要确认用户授权机制" },
  { id: "personal-data-fields", domain: "personal_information", label: "Data Fields", features: ["personal_information"], why: "设计与开发需要明确采集字段范围" },
  { id: "processing-purpose", domain: "personal_information", label: "Processing Purpose", features: ["personal_information"], why: "数据流程需要明确处理目的" },
  { id: "storage-retention", domain: "personal_information", label: "Storage / Retention", features: ["personal_information"], why: "数据方案需要确认保存与保留要求是否已定义" },
  { id: "third-party-sharing", domain: "personal_information", label: "Third-party Sharing", features: ["third_party_sharing"], why: "第三方共享范围必须由项目资料明确" },

  { id: "biometric-consent", domain: "photo_face_biometric", label: "User Consent", features: ["photo_face_biometric"], why: "照片或人脸处理需要明确用户授权" },
  { id: "sensitive-information-handling", domain: "photo_face_biometric", label: "Sensitive Personal Information Handling", features: ["photo_face_biometric"], why: "敏感信息处理方式必须由项目资料确认" },
  { id: "photo-retention-deletion", domain: "photo_face_biometric", label: "Retention / Deletion", features: ["photo_face_biometric"], why: "照片或人脸数据需要明确保留与删除安排" },
  { id: "processing-provider-location", domain: "photo_face_biometric", label: "Processing Provider / Location", features: ["photo_face_biometric"], why: "当项目要求时需确认处理方与处理位置" },
  { id: "photo-user-notice", domain: "photo_face_biometric", label: "User Notice", features: ["photo_face_biometric"], why: "用户界面需要明确照片或人脸处理提示" },

  { id: "brand-guideline", domain: "visual_design", label: "Brand Guideline", features: ["visual_design"], why: "视觉方案需要品牌规范作为输入" },
  { id: "logo-assets", domain: "visual_design", label: "Logo", features: ["visual_design"], why: "视觉交付需要可用 Logo 资产" },
  { id: "font-assets", domain: "visual_design", label: "Fonts", features: ["visual_design"], why: "视觉与前端实现需要确认字体资产和使用要求" },
  { id: "color-system", domain: "visual_design", label: "Color", features: ["visual_design"], why: "视觉方案需要颜色规范" },
  { id: "visual-assets", domain: "visual_design", label: "Visual Assets", features: ["visual_design"], why: "设计排期依赖所需素材是否齐备" },
  { id: "copy-localization", domain: "visual_design", label: "Copy / Localization", features: ["visual_design"], why: "页面设计与验收需要明确文案和语言范围" },
  { id: "reference-design", domain: "visual_design", label: "Reference Design", features: ["visual_design"], why: "参考方向缺失会影响设计确认路径" },

  { id: "development-scope", domain: "development_integration", label: "Scope", features: ["development"], why: "开发拆解必须绑定明确范围" },
  { id: "frontend-backend-dependency", domain: "development_integration", label: "Frontend / Backend Dependency", features: ["development"], why: "开发排期需要识别前后端依赖" },
  { id: "api-documentation", domain: "development_integration", label: "API Documentation", features: ["third_party_integration"], why: "第三方对接开发依赖可用接口文档" },
  { id: "integration-authentication", domain: "development_integration", label: "Authentication", features: ["third_party_integration"], why: "联调前必须明确认证方式" },
  { id: "test-environment", domain: "development_integration", label: "Test Environment", features: ["third_party_integration"], why: "接口联调与验收需要测试环境" },
  { id: "parameter-rules", domain: "development_integration", label: "Parameter Rules", features: ["third_party_integration"], why: "接口实现需要明确参数约束" },
  { id: "integration-contact", domain: "development_integration", label: "Owner / Contact", features: ["third_party_integration"], why: "联调阻塞需要明确可联系的责任方" },
  { id: "domain-hosting", domain: "development_integration", label: "Domain / Hosting", features: ["web_hosting"], why: "Web 上线需要明确域名与托管条件" },

  { id: "uat", domain: "launch_uat", label: "UAT", features: ["launch"], why: "上线前需要明确 UAT 安排" },
  { id: "acceptance", domain: "launch_uat", label: "Acceptance", features: ["launch"], why: "交付边界需要明确验收方式" },
  { id: "production-configuration", domain: "launch_uat", label: "Production Configuration", features: ["launch"], why: "上线需要明确生产配置准备" },
  { id: "release-date", domain: "launch_uat", label: "Release Date", features: ["launch"], why: "上线排期需要明确或待确认的发布日期" },
  { id: "approval-review-dependency", domain: "launch_uat", label: "Approval / Review Dependency", features: ["launch"], why: "发布前置审批或评审必须可见" },
  { id: "go-live-dependency", domain: "launch_uat", label: "Go-live Dependency", features: ["launch"], why: "上线依赖必须进入排期" },

  { id: "device-model", domain: "hardware", label: "Device Model", features: ["hardware"], why: "硬件适配依赖具体设备型号" },
  { id: "device-resolution", domain: "hardware", label: "Resolution", features: ["hardware"], why: "屏幕与视觉实现依赖分辨率" },
  { id: "device-network", domain: "hardware", label: "Network", features: ["hardware"], why: "现场运行依赖网络条件" },
  { id: "installation-environment", domain: "hardware", label: "Installation Environment", features: ["hardware"], why: "安装与测试计划依赖现场环境" },
  { id: "onsite-setup", domain: "hardware", label: "Onsite Setup", features: ["hardware"], why: "线下设备需要安排现场安装与验证" },
  { id: "hardware-responsible-party", domain: "hardware", label: "Responsible Party", features: ["hardware"], why: "硬件交付需要明确责任方" },
] as const;

export function requirementCatalogForFeatures(
  features: ReadonlySet<TimelineMakerFeature>,
): TimelineMakerRequirementCatalogItem[] {
  return TIMELINE_MAKER_REQUIREMENT_CATALOG.filter((item) =>
    item.features.some((feature) => features.has(feature)),
  );
}

export function buildRequirementChecklist(input: {
  features: ReadonlySet<TimelineMakerFeature>;
  suppliedEvidence?: Readonly<Record<string, string>>;
  unclearRequirementIds?: ReadonlySet<string>;
  notApplicableRequirementIds?: ReadonlySet<string>;
}): TimelineMakerRequirement[] {
  const suppliedEvidence = input.suppliedEvidence ?? {};
  const unclear = input.unclearRequirementIds ?? new Set<string>();
  const notApplicable = input.notApplicableRequirementIds ?? new Set<string>();
  return requirementCatalogForFeatures(input.features).map((item) => {
    const evidence = suppliedEvidence[item.id]?.trim() || null;
    if (notApplicable.has(item.id)) {
      if (!evidence) {
        return {
          id: item.id,
          domain: item.domain,
          label: item.label,
          status: "UNCLEAR",
          evidence: null,
          reason: "标记为不适用但没有提供资料证据，需澄清",
        };
      }
      return {
        id: item.id,
        domain: item.domain,
        label: item.label,
        status: "NOT_APPLICABLE",
        evidence,
        reason: "用户资料明确表明本项目不适用此项",
      };
    }
    if (evidence) {
      return {
        id: item.id,
        domain: item.domain,
        label: item.label,
        status: "CONFIRMED",
        evidence,
        reason: "用户资料已明确提供",
      };
    }
    if (unclear.has(item.id)) {
      return {
        id: item.id,
        domain: item.domain,
        label: item.label,
        status: "UNCLEAR",
        evidence: null,
        reason: item.why + "；当前资料含糊，需澄清",
      };
    }
    return {
      id: item.id,
      domain: item.domain,
      label: item.label,
      status: "MISSING",
      evidence: null,
      reason: item.why,
    };
  });
}

export function requirementGapTasks(input: {
  requirements: TimelineMakerRequirement[];
  stage: string;
}): TimelineMakerTask[] {
  return input.requirements
    .filter((item) => item.status === "MISSING" || item.status === "UNCLEAR")
    .map((item) => ({
      id: "gap-" + item.id,
      stage: input.stage,
      name: (item.status === "MISSING" ? "获取 / 确认 " : "澄清 ") + item.label,
      owners: [],
      status: "incomplete" as const,
      start: "" as const,
      end: "" as const,
      basis: "requirement_gap" as const,
      basisDetail: item.reason,
      requirementIds: [item.id],
      assumptionId: null,
    }));
}
