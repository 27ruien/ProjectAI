import { createHash } from "node:crypto";
import { PRODUCT_MAP_STEP_IDS, type ProductMapStepId } from "./contracts";

function tagged(prompt: string, name: string): unknown {
  const match = prompt.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`));
  if (!match?.[1]) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function sourceIds(prompt: string): string[] {
  const value = tagged(prompt, "product_map_source_ids_json");
  return Array.isArray(value) ? value.filter((item): item is string => /^S[1-9][0-9]*$/.test(String(item))).slice(0, 20) : ["S1"];
}

function evidence(prompt: string, ids: string[]): Array<Record<string, unknown>> {
  const value = tagged(prompt, "product_map_evidence_json");
  if (Array.isArray(value) && value.length) return value as Array<Record<string, unknown>>;
  const excerpt = "受控资料说明项目目标、目标用户和核心流程，未覆盖的内容需要项目经理确认。";
  return ids.slice(0, 3).map((sourceId, index) => ({
    id: `E${index + 1}`,
    sourceId,
    sourceType: "document",
    displayName: `资料 ${sourceId}`,
    versionId: `${sourceId}-version`,
    chunkId: `${sourceId}-chunk`,
    locator: "markdown:1",
    excerpt,
    excerptDigest: createHash("sha256").update(excerpt).digest("hex"),
    relevance: "high",
    reliability: "high",
    sourceRefs: [sourceId],
  }));
}

function stepId(prompt: string): ProductMapStepId {
  const value = tagged(prompt, "product_map_step_json");
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { stepId?: unknown }).stepId
    : undefined;
  return typeof candidate === "string" && (PRODUCT_MAP_STEP_IDS as readonly string[]).includes(candidate)
    ? candidate as ProductMapStepId
    : "evidence_inventory";
}

function claim(text: string, refs: string[], confidence: "confirmed" | "inferred" | "unknown" = refs.length ? "confirmed" : "unknown") {
  return { text, confidence, sourceRefs: refs.slice(0, 20) };
}

function statusForRefs(refs: string[], preferred: "CONFIRMED" | "INFERRED" = "INFERRED") {
  return refs.length ? preferred : "MISSING" as const;
}

function contractCoverage(items: Array<{ evidenceStatus: "CONFIRMED" | "INFERRED" | "MISSING" | "CONFLICT" | "NOT_APPLICABLE" }>) {
  const counts = {
    confirmed: items.filter((item) => item.evidenceStatus === "CONFIRMED").length,
    inferred: items.filter((item) => item.evidenceStatus === "INFERRED").length,
    missing: items.filter((item) => item.evidenceStatus === "MISSING").length,
    conflict: items.filter((item) => item.evidenceStatus === "CONFLICT").length,
    notApplicable: items.filter((item) => item.evidenceStatus === "NOT_APPLICABLE").length,
  };
  const applicable = items.length - counts.notApplicable;
  return { ...counts, percentage: applicable ? Math.round((counts.confirmed / applicable) * 100) : 100 };
}

function base(prompt: string) {
  const refs = sourceIds(prompt);
  const ev = evidence(prompt, refs);
  const sufficient = ev.length >= 3;
  const fields = ["project_background", "business_goal", "target_user", "platform_context", "core_requirements", "business_rules"].map((field) => ({
    field,
    status: sufficient ? "present" : "missing",
    evidenceCount: ev.length,
    reliableEvidenceCount: ev.length,
    summary: sufficient ? "来自授权资料的可核验事实。" : "资料不足，待项目经理补充。",
    sourceRefs: refs,
  }));
  const completeness = {
    status: sufficient ? "sufficient" : "insufficient",
    accessibleSourceCount: refs.length,
    retrievedEvidenceCount: ev.length,
    reliableEvidenceCount: ev.length,
    fields,
    missingFields: sufficient ? [] : fields.map((field) => field.field),
    conflicts: [],
    irrelevantRetrieval: false,
    unparsedSourceIds: [],
    reasons: sufficient ? [] : ["业务目标和核心需求资料不足。"],
    limitedEvidence: !sufficient,
  };
  const sourceRefs = refs.slice(0, 3).map((sourceId) => {
    const items = ev.filter((item) => item.sourceId === sourceId);
    return {
      sourceId,
      sourceType: items[0]?.sourceType === "user_input" ? "user_input" : "document",
      displayName: String(items[0]?.displayName ?? `资料 ${sourceId}`),
      locator: String(items[0]?.locator ?? "markdown:1"),
      citation: `[${sourceId}] ${String(items[0]?.displayName ?? `资料 ${sourceId}`)}`,
      evidenceBindings: items.map((item) => ({ evidenceId: item.id, versionId: item.versionId, chunkId: item.chunkId, locator: item.locator, excerptDigest: item.excerptDigest })),
    };
  });
  const quality = {
    checks: [
      ["goal_closure", "目标与结构闭环"], ["path_completeness", "路径包含正常和异常状态"], ["map_implementable", "结构可实现"],
      ["pages_acceptable", "页面可验收"], ["features_executable", "功能含输入输出和边界"], ["evidence_traceability", "证据可追溯"], ["scope_control", "范围受控"],
    ].map(([id, condition]) => ({ id, condition, result: sufficient ? "PASS" : "待确认", note: sufficient ? "确定性结构检查通过。" : "证据不足，需人工确认。", relatedIds: ["G1", "J1", "M1", "P1", "F1"] })),
    overall: sufficient ? "通过" : "需确认",
    blockers: sufficient ? [] : ["业务目标和核心需求仍待确认"],
  };
  const artifact = {
    schemaVersion: "projectai-product-map-v1",
    integrityNote: "Fake Provider 仅用于 CI 和隔离验收；正式结果仍需人工审核。",
    completeness,
    materialInventory: {
      materials: refs.map((sourceId) => ({ sourceId, fileName: String(ev.find((item) => item.sourceId === sourceId)?.displayName ?? `资料 ${sourceId}`), fileType: "text/markdown", keyContent: String(ev.find((item) => item.sourceId === sourceId)?.excerpt ?? "待确认"), confidence: ev.some((item) => item.sourceId === sourceId) ? "confirmed" : "unknown", sourceRefs: [sourceId] })),
      evidence: ev,
      deduplicatedSourceIds: refs,
      conflicts: [],
      modelCompleteness: { status: sufficient ? "sufficient" : "insufficient", missingFields: sufficient ? [] : fields.map((field) => field.field), conflictIds: [], reasons: completeness.reasons },
    },
    projectUnderstanding: {
      projectName: claim("受控 Product Map 验收项目", refs),
      projectBackground: claim("根据当前授权资料整理项目背景。", refs),
      oneLinePositioning: claim("帮助项目经理从零散资料形成可追溯的产品结构。", refs, "inferred"),
      targetUsers: [claim("项目经理", refs)],
      useCases: [claim("理解项目并梳理用户路径", refs)],
      businessStakeholders: [claim("项目经理与业务负责人", refs, "inferred")],
      technicalStakeholders: [claim("项目技术团队", refs, "inferred")],
      businessGoals: [claim("让项目经理形成可评审的产品结构。", refs)],
      desiredUserBehaviors: [claim("项目经理核对资料、查看结构并确认草稿。", refs)],
      businessOutcomes: [claim("减少需求遗漏与理解偏差。", refs, "inferred")],
      externalSystems: [claim("项目资料与解析服务", refs, "inferred")],
      thirdParties: [claim("未明确第三方", [], "unknown")],
      confirmedDecisions: [claim("最终结果需人工审核后才能发布。", refs)],
      uncertainties: [claim("业务成功指标仍待确认。", [], "unknown")],
      platformContext: claim("Web 应用（平台细节待确认）", refs, "inferred"),
      projectPeriod: claim("待确认", [], "unknown"),
      inScope: [claim("项目理解、目标、路径、页面和功能结构", refs)],
      outOfScope: [claim("未经人工审核的正式业务写入", refs)],
      knownConstraints: [claim("每项重要结论必须带引用或标记待确认", refs)],
    },
    goals: { goals: [{ id: "G1", businessGoalId: "BG1", userGoalId: "UG1", goal: "让项目经理形成可评审的产品结构。", expectedUserBehavior: "项目经理核对资料、查看结构并确认草稿。", measurement: "审核完成率（指标待确认）。", status: refs.length ? "confirmed" : "unknown", sourceRefs: refs, journeyIds: ["J1"], moduleIds: ["M1"] }] },
    userPath: { steps: ["进入", "盘点资料", "理解目标", "检查结构", "审核发布"].map((stage, index) => ({ id: `J${index + 1}`, stage, trigger: index ? `J${index} 已完成` : "已登录并进入 Product Map", userAction: `项目经理执行${stage}阶段动作。`, systemFeedback: "系统展示明确状态和引用。", entryCondition: index ? `J${index} 完成` : "已登录并有项目权限", exitCondition: index === 4 ? "草稿审核或保留待确认项" : `进入 J${index + 2}`, pageIds: ["P1"], surfaceIds: ["P1"], goalIds: ["G1"], stateIds: ["ST1"], confidence: refs.length ? "confirmed" : "unknown", sourceRefs: refs })), pathSummary: "进入 → 盘点资料 → 理解目标 → 检查结构 → 审核发布" },
    productMap: { rootName: "产品结构", modules: [{ id: "M1", name: "核心项目工作流", purpose: "支持项目经理理解和审核产品结构。", goalIds: ["G1"], evidenceStatus: statusForRefs(refs, "CONFIRMED"), citations: refs, surfaces: [{ stableId: "P1", name: "Product Map 工作区", kind: "page", purpose: "查看并审核产品结构。", evidenceStatus: statusForRefs(refs), citations: refs, features: [{ featureId: "F1", actionIds: ["A1"], stateIds: ["ST1"] }] }] }] },
    pages: { pages: [{ id: "P1", name: "Product Map 工作区", purpose: "让项目经理检查资料并审核产品结构。", userRoles: ["项目经理"], entry: "从 AI 助手选择 Product Map。", coreContent: ["来源证据", "产品结构草稿"], coreActions: ["选择资料", "查看引用", "审核草稿"], states: ["empty", "loading", "success"], exceptionStates: ["error", "permission denied"], navigation: ["审核结果"], dependencies: ["项目资料解析"], priority: "Must", moduleId: "M1", goalIds: ["G1"], evidenceStatus: statusForRefs(refs), citations: refs }] },
    features: { features: [{ id: "F1", name: "检查并生成产品结构", purpose: "将授权证据整理成可审核草稿。", userRole: "项目经理", entry: "Product Map 工作区", action: "检查资料并执行固定八步", result: "结构化 Product Map、Markdown、Mermaid 和引用", states: ["empty", "loading", "success", "error", "permission denied"], actionDefinitions: [{ id: "A1", name: "检查并生成", trigger: "项目经理确认资料后执行", result: "生成可审核的 Product Map 草稿", evidenceStatus: statusForRefs(refs), citations: refs }], stateDefinitions: [{ id: "ST1", name: "success", meaning: "结构化草稿已生成并保留引用", evidenceStatus: statusForRefs(refs), citations: refs }], dependencies: ["ProjectKnowledgeService", "场景模型绑定"], pageIds: ["P1"], moduleId: "M1", priority: "Must", evidenceStatus: statusForRefs(refs), citations: refs }] },
    risksAndQuestions: { risks: [], questions: sufficient ? [] : [{ id: "Q1", type: "question", description: "请补充业务目标和核心需求。", impactObjects: ["G1", "F1"], impact: "high", suggestedConfirmer: "项目经理", priority: "P0", sourceRefs: [] }] },
    quality,
    citations: sourceRefs,
    stepOutputs: PRODUCT_MAP_STEP_IDS.map((stepId) => ({ stepId, stepVersion: "projectai-product-map-v1", status: "completed", output: {}, sourceRefs: refs, outputDigest: createHash("sha256").update(`${stepId}`).digest("hex"), createdAt: new Date().toISOString() })),
    handoffSummary: { projectPositioning: "可追溯的产品结构草案。", minimumPath: "进入 → 盘点资料 → 理解目标 → 检查结构 → 审核发布", mustPages: ["P1"], mustFeatures: ["F1"], blockers: sufficient ? [] : ["业务目标和核心需求待确认"], downstreamFiles: ["product-map.json", "product-map.md"] },
    analysisContract: null as unknown,
  };
  const analysisSources = refs.map((sourceId) => ({ id: sourceId, kind: "project_document" as const, label: String(ev.find((item) => item.sourceId === sourceId)?.displayName ?? `资料 ${sourceId}`), evidenceStatus: ev.some((item) => item.sourceId === sourceId) ? "CONFIRMED" as const : "MISSING" as const, citationIds: ev.filter((item) => item.sourceId === sourceId).map((item) => String(item.id)) }));
  const refsForAnalysis = refs.length ? refs : [];
  const exceptionKinds = ["happy_path", "unauthenticated", "permission_denied", "empty_data", "network_failure", "api_failure", "third_party_failure", "user_cancelled", "duplicate_submission", "timeout", "already_completed", "ineligible", "return_to_previous_step"] as const;
  const exceptionPaths = exceptionKinds.map((kind, index) => {
    const isConflict = kind === "api_failure" && refsForAnalysis.length >= 2;
    const isApplicable = kind === "happy_path" || kind === "permission_denied" || kind === "api_failure";
    const evidenceStatus = kind === "network_failure" ? "MISSING" as const : isConflict ? "CONFLICT" as const : isApplicable ? statusForRefs(refsForAnalysis) : "NOT_APPLICABLE" as const;
    return { id: `EX${index + 1}`, kind, trigger: `${kind} 触发`, expectedHandling: evidenceStatus === "NOT_APPLICABLE" ? "当前项目明确不适用。" : evidenceStatus === "MISSING" ? "资料未说明，保留待确认。" : "保留状态并显示可审核提示。", terminalState: evidenceStatus === "NOT_APPLICABLE" ? "不适用" : "需确认", evidenceStatus, sourceRefs: evidenceStatus === "CONFLICT" ? refsForAnalysis.slice(0, 2) : evidenceStatus === "NOT_APPLICABLE" || evidenceStatus === "MISSING" ? [] : refsForAnalysis };
  });
  const scopeItems = {
    inScope: [{ statement: "项目理解、用户路径、页面和功能结构", evidenceStatus: statusForRefs(refsForAnalysis), sourceRefs: refsForAnalysis }],
    outOfScope: [{ statement: "未经人工审核的正式业务写入", evidenceStatus: statusForRefs(refsForAnalysis), sourceRefs: refsForAnalysis }],
    tbd: sufficient ? [] : [{ statement: "核心业务指标和上线条件", evidenceStatus: "MISSING" as const, sourceRefs: [] }],
    dependencies: [{ statement: "项目资料解析与场景模型绑定", evidenceStatus: statusForRefs(refsForAnalysis), sourceRefs: refsForAnalysis }],
  };
  const goalLinks = [{ businessGoalId: "BG1", userGoalId: "UG1", statement: "让项目经理形成可评审的产品结构。", businessGoal: "减少需求遗漏和理解偏差", userGoal: "项目经理能核对资料并审核草稿", currentSolution: refsForAnalysis.length ? "Product Map 工作流" : undefined, solutionHypothesis: refsForAnalysis.length ? { statement: "以固定八步形成可审核的产品结构草稿", evidenceStatus: statusForRefs(refsForAnalysis), sourceRefs: refsForAnalysis } : undefined, evidenceStatus: statusForRefs(refsForAnalysis), sourceRefs: refsForAnalysis }];
  const roles = [{ role: "项目经理", roleType: "user" as const, canView: ["Product Map 草稿"], canOperate: ["执行工作流"], canModify: ["编辑草稿"], canConfirm: ["审核和发布"], canDelete: ["取消自己的 Run"], evidenceStatus: statusForRefs(refsForAnalysis), sourceRefs: refsForAnalysis }];
  const statusItems = [...analysisSources, ...goalLinks, ...goalLinks.flatMap((item) => item.solutionHypothesis ? [item.solutionHypothesis] : []), ...scopeItems.inScope, ...scopeItems.outOfScope, ...scopeItems.tbd, ...scopeItems.dependencies, ...roles, ...exceptionPaths];
  artifact.analysisContract = { sources: analysisSources, goalLinks, scope: scopeItems, roles, exceptionPaths, evidenceCoverage: contractCoverage(statusItems) };
  return { artifact, completeness, quality, evidence: ev, sourceRefs };
}

export function fakeProductMapResponse(prompt: string): string {
  if (
    prompt.includes("FAKE_PRODUCT_MAP_INVALID_ALWAYS") ||
    (prompt.includes("FAKE_PRODUCT_MAP_INVALID_ONCE") &&
      !prompt.includes("<product_map_repair_feedback_json>"))
  ) {
    return "{invalid-product-map-json";
  }
  const result = base(prompt);
  const id = stepId(prompt);
  if (id === "evidence_inventory") return JSON.stringify(result.artifact.materialInventory);
  if (id === "project_understanding") return JSON.stringify(result.artifact.projectUnderstanding);
  if (id === "goals_and_behaviors") return JSON.stringify(result.artifact.goals);
  if (id === "user_path") return JSON.stringify(result.artifact.userPath);
  if (id === "product_map") return JSON.stringify(result.artifact.productMap);
  if (id === "pages_and_features") return JSON.stringify({ pages: result.artifact.pages.pages, features: result.artifact.features.features });
  if (id === "independent_review") return JSON.stringify(result.quality);
  return JSON.stringify(result.artifact);
}
