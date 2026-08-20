import { z } from "zod";

/**
 * Product Map is deliberately model/provider neutral.  The workflow service
 * resolves the trusted model profile; callers only send the bounded input
 * below.  Keep these constants in one place so the API, worker and UI cannot
 * drift apart.
 */
export const PRODUCT_MAP_SKILL_ID = "product-map" as const;
export const PRODUCT_MAP_SKILL_VERSION = "1.0.0" as const;
export const PRODUCT_MAP_WORKFLOW_TYPE = "skill_execution" as const;
export const PRODUCT_MAP_ARTIFACT_KIND = "product_map" as const;
export const PRODUCT_MAP_SCHEMA_VERSION = "projectai-product-map-v1" as const;

export const PRODUCT_MAP_SKILL_FILE_PATH = "skills/product-map/SKILL.md" as const;
// The digest is provenance metadata for the supplied SKILL.md.  The service
// must still load the file from the trusted repository path before enabling a
// newer version; it must never accept a caller-provided path.
export const PRODUCT_MAP_SKILL_FILE_SHA256 =
  "29fd6d2e7942d6a840cc995dc74ec53342931bb54d83026167a3ed24493ec20a" as const;

export const PRODUCT_MAP_RUN_STATES = [
  "queued",
  "checking_sources",
  "needs_input",
  "uploading",
  "indexing",
  "retrieving",
  "running",
  "reviewing",
  "unknown",
  "completed",
  "published",
  "failed",
  "cancelled",
] as const;
export type ProductMapRunState = (typeof PRODUCT_MAP_RUN_STATES)[number];
export const productMapRunStateSchema = z.enum(PRODUCT_MAP_RUN_STATES);

export const PRODUCT_MAP_STEP_IDS = [
  "evidence_inventory",
  "project_understanding",
  "goals_and_behaviors",
  "user_path",
  "product_map",
  "pages_and_features",
  "independent_review",
  "final_artifact",
] as const;
export type ProductMapStepId = (typeof PRODUCT_MAP_STEP_IDS)[number];
export const productMapStepIdSchema = z.enum(PRODUCT_MAP_STEP_IDS);

export const PRODUCT_MAP_STEP_LABELS: Record<ProductMapStepId, string> = {
  evidence_inventory: "材料盘点与证据整理",
  project_understanding: "项目理解",
  goals_and_behaviors: "目标与用户行为",
  user_path: "用户路径",
  product_map: "产品功能结构",
  pages_and_features: "页面与功能清单",
  independent_review: "独立结构审查",
  final_artifact: "生成最终结果",
};

export const PRODUCT_MAP_COVERAGE_FIELDS = [
  "project_background",
  "business_goal",
  "target_user",
  "platform_context",
  "core_requirements",
  "business_rules",
] as const;
export type ProductMapCoverageField = (typeof PRODUCT_MAP_COVERAGE_FIELDS)[number];
export const productMapCoverageFieldSchema = z.enum(PRODUCT_MAP_COVERAGE_FIELDS);

export const PRODUCT_MAP_QUALITY_CHECK_IDS = [
  "goal_closure",
  "path_completeness",
  "map_implementable",
  "pages_acceptable",
  "features_executable",
  "evidence_traceability",
  "scope_control",
] as const;
export type ProductMapQualityCheckId = (typeof PRODUCT_MAP_QUALITY_CHECK_IDS)[number];

export const PRODUCT_MAP_MAX_SELECTED_SOURCES = 20;
export const PRODUCT_MAP_MAX_UPLOADED_SOURCES = 10;
export const PRODUCT_MAP_MAX_RETRIEVAL_INSTRUCTION = 4_000;
export const PRODUCT_MAP_MAX_USER_INPUT = 20_000;
export const PRODUCT_MAP_MAX_TOP_LEVEL_MODULES = 8;
export const PRODUCT_MAP_MAX_PAGES = 20;
export const PRODUCT_MAP_MAX_FEATURES = 40;
export const PRODUCT_MAP_MAX_SOURCE_REFERENCES = PRODUCT_MAP_MAX_SELECTED_SOURCES + PRODUCT_MAP_MAX_UPLOADED_SOURCES + 3;
export const PRODUCT_MAP_MAX_EVIDENCE_ITEMS = 100;

const identifierSchema = z.string().trim().min(1).max(200);
const sourceIdSchema = z.string().regex(/^S[1-9][0-9]*$/);
const evidenceIdSchema = z.string().regex(/^E[1-9][0-9]*$/);
const goalIdSchema = z.string().regex(/^G[1-9][0-9]*$/);
const journeyIdSchema = z.string().regex(/^J[1-9][0-9]*$/);
const moduleIdSchema = z.string().regex(/^M[1-9][0-9]*$/);
const pageIdSchema = z.string().regex(/^P[1-9][0-9]*$/);
const featureIdSchema = z.string().regex(/^F[1-9][0-9]*$/);
const riskIdSchema = z.string().regex(/^R[1-9][0-9]*$/);
const questionIdSchema = z.string().regex(/^Q[1-9][0-9]*$/);
const businessGoalIdSchema = z.string().regex(/^BG[1-9][0-9]*$/);
const userGoalIdSchema = z.string().regex(/^UG[1-9][0-9]*$/);
const exceptionPathIdSchema = z.string().regex(/^EX[1-9][0-9]*$/);
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const optionalBoundedText = (max: number) => z.string().trim().max(max).optional();

export const productMapConfidenceSchema = z.enum(["confirmed", "inferred", "unknown"]);
export type ProductMapConfidence = z.infer<typeof productMapConfidenceSchema>;

/** PM evidence state used in the persisted analysis contract.  The values are
 * intentionally explicit so an inference can never be rendered as a fact. */
export const productMapEvidenceStatusSchema = z.enum([
  "CONFIRMED",
  "INFERRED",
  "MISSING",
  "CONFLICT",
  "NOT_APPLICABLE",
]);
export type ProductMapEvidenceStatus = z.infer<typeof productMapEvidenceStatusSchema>;

function validateEvidenceStatus(
  value: { evidenceStatus: ProductMapEvidenceStatus; sourceRefs: string[] },
  context: z.RefinementCtx,
): void {
  if (["CONFIRMED", "INFERRED"].includes(value.evidenceStatus) && value.sourceRefs.length === 0) {
    context.addIssue({ code: "custom", path: ["sourceRefs"], message: `${value.evidenceStatus} requires an evidence source` });
  }
  if (value.evidenceStatus === "CONFLICT" && value.sourceRefs.length < 2) {
    context.addIssue({ code: "custom", path: ["sourceRefs"], message: "CONFLICT requires at least two evidence sources" });
  }
  if (["MISSING", "NOT_APPLICABLE"].includes(value.evidenceStatus) && value.sourceRefs.length > 0) {
    context.addIssue({ code: "custom", path: ["sourceRefs"], message: `${value.evidenceStatus} must not claim an evidence source` });
  }
}

export const productMapAnalysisSourceSchema = z.object({
  id: sourceIdSchema,
  kind: z.enum([
    "current_user_input",
    "conversation",
    "project_document",
    "company_document",
    "explicit_project_reference",
    "explicit_file_reference",
    "uploaded_source",
    "historical_artifact",
  ]),
  label: boundedText(240),
  evidenceStatus: productMapEvidenceStatusSchema,
  citationIds: z.array(evidenceIdSchema).max(PRODUCT_MAP_MAX_EVIDENCE_ITEMS),
}).strict().superRefine((value, context) => {
  if (["CONFIRMED", "INFERRED"].includes(value.evidenceStatus) && value.citationIds.length === 0) {
    context.addIssue({ code: "custom", path: ["citationIds"], message: `${value.evidenceStatus} source requires citations` });
  }
  if (value.evidenceStatus === "CONFLICT" && value.citationIds.length < 2) {
    context.addIssue({ code: "custom", path: ["citationIds"], message: "CONFLICT source requires at least two citations" });
  }
  if (["MISSING", "NOT_APPLICABLE"].includes(value.evidenceStatus) && value.citationIds.length > 0) {
    context.addIssue({ code: "custom", path: ["citationIds"], message: `${value.evidenceStatus} source must not claim citations` });
  }
});

export const productMapGoalLinkSchema = z.object({
  businessGoalId: businessGoalIdSchema,
  userGoalId: userGoalIdSchema,
  statement: boundedText(2_000),
  /** Keep the desired outcome separate from a proposed/current solution. */
  businessGoal: optionalBoundedText(2_000),
  userGoal: optionalBoundedText(2_000),
  currentSolution: optionalBoundedText(2_000),
  /** A solution is a hypothesis or current approach, never the goal itself. */
  solutionHypothesis: z.object({
    statement: boundedText(2_000),
    evidenceStatus: productMapEvidenceStatusSchema,
    sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  }).strict().optional(),
  evidenceStatus: productMapEvidenceStatusSchema,
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => {
  validateEvidenceStatus(value, context);
  if (value.solutionHypothesis) validateEvidenceStatus(value.solutionHypothesis, context);
});

export const productMapScopeItemSchema = z.object({
  statement: boundedText(1_000),
  evidenceStatus: productMapEvidenceStatusSchema,
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine(validateEvidenceStatus);

export const productMapScopeSchema = z.object({
  inScope: z.array(productMapScopeItemSchema).max(40),
  outOfScope: z.array(productMapScopeItemSchema).max(40),
  tbd: z.array(productMapScopeItemSchema).max(40),
  dependencies: z.array(productMapScopeItemSchema).max(40),
}).strict();

export const productMapRoleCapabilitySchema = z.object({
  role: boundedText(160),
  roleType: z.enum(["user", "admin", "internal", "external", "anonymous", "authenticated"]),
  canView: z.array(boundedText(240)).max(40),
  canOperate: z.array(boundedText(240)).max(40),
  canModify: z.array(boundedText(240)).max(40),
  canConfirm: z.array(boundedText(240)).max(40),
  canDelete: z.array(boundedText(240)).max(40),
  evidenceStatus: productMapEvidenceStatusSchema,
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine(validateEvidenceStatus);

export const PRODUCT_MAP_EXCEPTION_KINDS = [
  "happy_path",
  "unauthenticated",
  "permission_denied",
  "empty_data",
  "network_failure",
  "api_failure",
  "third_party_failure",
  "user_cancelled",
  "duplicate_submission",
  "timeout",
  "already_completed",
  "ineligible",
  "return_to_previous_step",
] as const;

export const productMapExceptionPathSchema = z.object({
  id: exceptionPathIdSchema,
  kind: z.enum(PRODUCT_MAP_EXCEPTION_KINDS),
  trigger: boundedText(500),
  expectedHandling: boundedText(1_000),
  terminalState: boundedText(160),
  evidenceStatus: productMapEvidenceStatusSchema,
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine(validateEvidenceStatus);

export const productMapAnalysisContractSchema = z.object({
  sources: z.array(productMapAnalysisSourceSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  goalLinks: z.array(productMapGoalLinkSchema).min(1).max(40),
  scope: productMapScopeSchema,
  roles: z.array(productMapRoleCapabilitySchema).min(1).max(30),
  exceptionPaths: z.array(productMapExceptionPathSchema).length(PRODUCT_MAP_EXCEPTION_KINDS.length),
  evidenceCoverage: z.object({
    confirmed: z.number().int().min(0),
    inferred: z.number().int().min(0),
    missing: z.number().int().min(0),
    conflict: z.number().int().min(0),
    notApplicable: z.number().int().min(0),
    percentage: z.number().min(0).max(100),
  }).strict(),
}).strict().superRefine((value, context) => {
  const sourceIds = new Set(value.sources.map((source) => source.id));
  if (sourceIds.size !== value.sources.length) {
    context.addIssue({ code: "custom", path: ["sources"], message: "analysis source ids must be unique" });
  }
  const exceptionKinds = new Set(value.exceptionPaths.map((path) => path.kind));
  if (exceptionKinds.size !== PRODUCT_MAP_EXCEPTION_KINDS.length) {
    context.addIssue({ code: "custom", path: ["exceptionPaths"], message: "each required normal or exception path must be checked exactly once" });
  }
  const statusItems = [
    ...value.sources,
    ...value.goalLinks,
    ...value.goalLinks.flatMap((link) => link.solutionHypothesis ? [link.solutionHypothesis] : []),
    ...value.scope.inScope,
    ...value.scope.outOfScope,
    ...value.scope.tbd,
    ...value.scope.dependencies,
    ...value.roles,
    ...value.exceptionPaths,
  ];
  for (const [index, item] of statusItems.entries()) {
    if ("sourceRefs" in item) {
      for (const sourceRef of item.sourceRefs) {
        if (!sourceIds.has(sourceRef)) {
          context.addIssue({ code: "custom", path: ["sourceRefs", index], message: `analysis references unknown source: ${sourceRef}` });
        }
      }
    }
  }
  const expected = {
    confirmed: statusItems.filter((item) => item.evidenceStatus === "CONFIRMED").length,
    inferred: statusItems.filter((item) => item.evidenceStatus === "INFERRED").length,
    missing: statusItems.filter((item) => item.evidenceStatus === "MISSING").length,
    conflict: statusItems.filter((item) => item.evidenceStatus === "CONFLICT").length,
    notApplicable: statusItems.filter((item) => item.evidenceStatus === "NOT_APPLICABLE").length,
  };
  for (const [key, count] of Object.entries(expected)) {
    if (value.evidenceCoverage[key as keyof typeof expected] !== count) {
      context.addIssue({ code: "custom", path: ["evidenceCoverage", key], message: `coverage count must equal ${count}` });
    }
  }
  const applicable = statusItems.length - expected.notApplicable;
  const expectedPercentage = applicable > 0 ? Math.round((expected.confirmed / applicable) * 100) : 100;
  if (value.evidenceCoverage.percentage !== expectedPercentage) {
    context.addIssue({ code: "custom", path: ["evidenceCoverage", "percentage"], message: `coverage percentage must equal ${expectedPercentage}` });
  }
});
export type ProductMapAnalysisContract = z.infer<typeof productMapAnalysisContractSchema>;

export const productMapSourceTypeSchema = z.enum(["document", "company_document", "user_input"]);
export type ProductMapSourceType = z.infer<typeof productMapSourceTypeSchema>;

export const productMapEvidenceRelevanceSchema = z.enum(["high", "medium", "low", "irrelevant"]);
export const productMapEvidenceReliabilitySchema = z.enum(["high", "medium", "low"]);

export const productMapEvidenceSchema = z.object({
  id: evidenceIdSchema,
  sourceId: sourceIdSchema,
  sourceType: productMapSourceTypeSchema,
  displayName: boundedText(240),
  /** Trusted retrieval identity. These values are populated by the worker,
   * never accepted from the model as authoritative evidence metadata. */
  versionId: identifierSchema,
  chunkId: identifierSchema,
  locator: optionalBoundedText(240),
  excerpt: boundedText(2_000),
  excerptDigest: z.string().regex(/^[a-f0-9]{64}$/),
  relevance: productMapEvidenceRelevanceSchema,
  reliability: productMapEvidenceReliabilitySchema,
  sourceRefs: z.array(sourceIdSchema).min(1).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => {
  if (!value.sourceRefs.includes(value.sourceId)) {
    context.addIssue({ code: "custom", path: ["sourceRefs"], message: "evidence must reference its bound source" });
  }
});
export type ProductMapEvidence = z.infer<typeof productMapEvidenceSchema>;

export const productMapEvidenceBindingSchema = z.object({
  evidenceId: evidenceIdSchema,
  versionId: identifierSchema,
  chunkId: identifierSchema,
  locator: optionalBoundedText(240),
  excerptDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ProductMapEvidenceBinding = z.infer<typeof productMapEvidenceBindingSchema>;

export const productMapSourceReferenceSchema = z.object({
  sourceId: sourceIdSchema,
  sourceType: productMapSourceTypeSchema,
  displayName: boundedText(240),
  locator: optionalBoundedText(240),
  citation: boundedText(1_000),
  /** Every retrieved hit remains individually auditable even when several
   * chunks belong to the same source document. */
  evidenceBindings: z.array(productMapEvidenceBindingSchema)
    .min(1)
    .max(PRODUCT_MAP_MAX_EVIDENCE_ITEMS),
}).strict().superRefine((value, context) => {
  const evidenceIds = new Set(value.evidenceBindings.map((binding) => binding.evidenceId));
  const chunkKeys = new Set(value.evidenceBindings.map((binding) => `${binding.versionId}:${binding.chunkId}`));
  if (evidenceIds.size !== value.evidenceBindings.length) {
    context.addIssue({ code: "custom", path: ["evidenceBindings"], message: "citation evidence ids must be unique" });
  }
  if (chunkKeys.size !== value.evidenceBindings.length) {
    context.addIssue({ code: "custom", path: ["evidenceBindings"], message: "citation chunk bindings must be unique" });
  }
});
export type ProductMapSourceReference = z.infer<typeof productMapSourceReferenceSchema>;

/** A conclusion is always labelled; confirmed conclusions must cite evidence. */
export const productMapClaimSchema = z.object({
  text: boundedText(4_000),
  confidence: productMapConfidenceSchema,
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => {
  if ((value.confidence === "confirmed" || value.confidence === "inferred") && value.sourceRefs.length === 0) {
    context.addIssue({ code: "custom", path: ["sourceRefs"], message: "known or inferred conclusion requires at least one source reference" });
  }
});
export type ProductMapClaim = z.infer<typeof productMapClaimSchema>;

export const productMapMaterialSchema = z.object({
  sourceId: sourceIdSchema,
  fileName: boundedText(240),
  fileType: boundedText(80),
  uploadedAt: optionalBoundedText(80),
  keyContent: boundedText(2_000),
  confidence: productMapConfidenceSchema,
  sourceRefs: z.array(sourceIdSchema).min(1).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict();
export type ProductMapMaterial = z.infer<typeof productMapMaterialSchema>;

export const productMapEvidenceInventorySchema = z.object({
  materials: z.array(productMapMaterialSchema).max(PRODUCT_MAP_MAX_EVIDENCE_ITEMS),
  evidence: z.array(productMapEvidenceSchema).max(PRODUCT_MAP_MAX_EVIDENCE_ITEMS),
  deduplicatedSourceIds: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  conflicts: z.array(z.object({
    id: z.string().regex(/^R[1-9][0-9]?$/),
    description: boundedText(2_000),
    sourceRefs: z.array(sourceIdSchema).min(2).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  }).strict()).max(40),
  /**
   * A bounded, auditable judgment from the first structured step.  It is
   * advisory only: the worker always combines it with its deterministic
   * coverage matrix and never accepts model-supplied evidence identity.
   */
  modelCompleteness: z.object({
    status: z.enum(["sufficient", "insufficient"]),
    missingFields: z.array(z.enum(PRODUCT_MAP_COVERAGE_FIELDS)).max(PRODUCT_MAP_COVERAGE_FIELDS.length),
    conflictIds: z.array(riskIdSchema).max(40),
    reasons: z.array(boundedText(500)).max(20),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const evidenceIds = new Set(value.evidence.map((evidence) => evidence.id));
  const chunkKeys = new Set(value.evidence.map((evidence) => `${evidence.versionId}:${evidence.chunkId}`));
  if (evidenceIds.size !== value.evidence.length) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "evidence ids must be unique" });
  }
  if (chunkKeys.size !== value.evidence.length) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "evidence chunk bindings must be unique" });
  }
});
export type ProductMapEvidenceInventory = z.infer<typeof productMapEvidenceInventorySchema>;

const claimListSchema = z.array(productMapClaimSchema).max(40);

export const productMapProjectUnderstandingSchema = z.object({
  projectName: productMapClaimSchema,
  projectBackground: productMapClaimSchema,
  oneLinePositioning: productMapClaimSchema,
  targetUsers: claimListSchema,
  useCases: claimListSchema,
  businessStakeholders: claimListSchema,
  technicalStakeholders: claimListSchema,
  businessGoals: claimListSchema,
  desiredUserBehaviors: claimListSchema,
  businessOutcomes: claimListSchema,
  externalSystems: claimListSchema,
  thirdParties: claimListSchema,
  confirmedDecisions: claimListSchema,
  uncertainties: claimListSchema,
  platformContext: productMapClaimSchema,
  projectPeriod: productMapClaimSchema,
  inScope: claimListSchema,
  outOfScope: claimListSchema,
  knownConstraints: claimListSchema,
}).strict();
export type ProductMapProjectUnderstanding = z.infer<typeof productMapProjectUnderstandingSchema>;

export const productMapGoalSchema = z.object({
  id: goalIdSchema,
  /** PM-facing links retain the distinction between business and user goals. */
  businessGoalId: businessGoalIdSchema.optional(),
  userGoalId: userGoalIdSchema.optional(),
  goal: boundedText(2_000),
  expectedUserBehavior: boundedText(1_000),
  measurement: boundedText(1_000),
  status: productMapConfidenceSchema,
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  journeyIds: z.array(journeyIdSchema).max(5),
  moduleIds: z.array(moduleIdSchema).max(PRODUCT_MAP_MAX_TOP_LEVEL_MODULES),
}).strict().superRefine((value, context) => {
  if (value.status === "confirmed" && value.sourceRefs.length === 0) {
    context.addIssue({ code: "custom", path: ["sourceRefs"], message: "confirmed goal requires evidence" });
  }
  if (value.journeyIds.length === 0 && value.moduleIds.length === 0) {
    context.addIssue({ code: "custom", message: "goal must connect to a journey or module" });
  }
});
export type ProductMapGoal = z.infer<typeof productMapGoalSchema>;

export const productMapGoalsSchema = z.object({
  goals: z.array(productMapGoalSchema).max(40),
}).strict();
export type ProductMapGoals = z.infer<typeof productMapGoalsSchema>;

export const productMapJourneyStepSchema = z.object({
  id: journeyIdSchema,
  stage: boundedText(120),
  trigger: optionalBoundedText(500),
  userAction: boundedText(1_500),
  systemFeedback: boundedText(1_500),
  entryCondition: boundedText(1_000),
  exitCondition: boundedText(1_000),
  pageIds: z.array(pageIdSchema).max(PRODUCT_MAP_MAX_PAGES),
  surfaceIds: z.array(z.string().regex(/^(P|SF)[1-9][0-9]*$/)).max(PRODUCT_MAP_MAX_PAGES).optional(),
  goalIds: z.array(goalIdSchema).max(40),
  stateIds: z.array(z.string().regex(/^ST[1-9][0-9]*$/)).max(20).optional(),
  confidence: productMapConfidenceSchema,
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict();

export const productMapUserPathSchema = z.object({
  steps: z.array(productMapJourneyStepSchema).length(5),
  pathSummary: boundedText(2_000),
}).strict().superRefine((value, context) => {
  const expected = ["J1", "J2", "J3", "J4", "J5"];
  value.steps.forEach((step, index) => {
    if (step.id !== expected[index]) context.addIssue({ code: "custom", path: ["steps", index, "id"], message: `journey step must be ${expected[index]}` });
  });
});
export type ProductMapUserPath = z.infer<typeof productMapUserPathSchema>;

export const productMapStructureFeatureSchema = z.object({
  featureId: featureIdSchema,
  actionIds: z.array(z.string().regex(/^A[1-9][0-9]*$/)).min(1).max(20),
  stateIds: z.array(z.string().regex(/^ST[1-9][0-9]*$/)).min(1).max(20),
}).strict();

export const productMapSurfaceSchema = z.object({
  stableId: z.string().regex(/^(P|SF)[1-9][0-9]*$/),
  name: boundedText(240),
  kind: z.enum(["page", "surface"]),
  purpose: boundedText(2_000),
  features: z.array(productMapStructureFeatureSchema).min(1).max(PRODUCT_MAP_MAX_FEATURES),
  evidenceStatus: productMapEvidenceStatusSchema,
  citations: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => validateEvidenceStatus({ evidenceStatus: value.evidenceStatus, sourceRefs: value.citations }, context));
export type ProductMapSurface = z.infer<typeof productMapSurfaceSchema>;

export const productMapModuleSchema = z.object({
  id: moduleIdSchema,
  name: boundedText(240),
  purpose: boundedText(2_000),
  goalIds: z.array(goalIdSchema).max(40),
  evidenceStatus: productMapEvidenceStatusSchema,
  citations: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  surfaces: z.array(productMapSurfaceSchema).min(1).max(PRODUCT_MAP_MAX_PAGES),
}).strict().superRefine((value, context) => {
  if (value.goalIds.length === 0) context.addIssue({ code: "custom", path: ["goalIds"], message: "module must reference at least one goal" });
  validateEvidenceStatus({ evidenceStatus: value.evidenceStatus, sourceRefs: value.citations }, context);
});
export type ProductMapModule = z.infer<typeof productMapModuleSchema>;

export const productMapStructureSchema = z.object({
  rootName: boundedText(240),
  modules: z.array(productMapModuleSchema).max(PRODUCT_MAP_MAX_TOP_LEVEL_MODULES),
}).strict();
export type ProductMapStructure = z.infer<typeof productMapStructureSchema>;

const prioritySchema = z.enum(["Must", "Should", "Could", "待确认"]);
const stateListSchema = z.array(boundedText(120)).max(20);

/** Stable action/state definitions make the terminal two levels of the PM
 * hierarchy auditable instead of leaving A#/ST# as unexplained labels. */
export const productMapActionDefinitionSchema = z.object({
  id: z.string().regex(/^A[1-9][0-9]*$/),
  name: boundedText(240),
  trigger: boundedText(500),
  result: boundedText(1_000),
  evidenceStatus: productMapEvidenceStatusSchema,
  citations: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => validateEvidenceStatus({ evidenceStatus: value.evidenceStatus, sourceRefs: value.citations }, context));

export const productMapStateDefinitionSchema = z.object({
  id: z.string().regex(/^ST[1-9][0-9]*$/),
  name: boundedText(120),
  meaning: boundedText(1_000),
  evidenceStatus: productMapEvidenceStatusSchema,
  citations: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => validateEvidenceStatus({ evidenceStatus: value.evidenceStatus, sourceRefs: value.citations }, context));

export const productMapPageSchema = z.object({
  id: pageIdSchema,
  name: boundedText(240),
  purpose: boundedText(2_000),
  userRoles: z.array(boundedText(160)).min(1).max(20),
  entry: boundedText(1_000),
  coreContent: z.array(boundedText(1_000)).min(1).max(30),
  coreActions: z.array(boundedText(1_000)).min(1).max(30),
  states: stateListSchema,
  exceptionStates: stateListSchema,
  navigation: z.array(boundedText(500)).max(20),
  dependencies: z.array(boundedText(240)).max(20),
  priority: prioritySchema,
  moduleId: moduleIdSchema,
  goalIds: z.array(goalIdSchema).max(40),
  evidenceStatus: productMapEvidenceStatusSchema,
  citations: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => validateEvidenceStatus({ evidenceStatus: value.evidenceStatus, sourceRefs: value.citations }, context));
export type ProductMapPage = z.infer<typeof productMapPageSchema>;

export const productMapPagesSchema = z.object({
  pages: z.array(productMapPageSchema).max(PRODUCT_MAP_MAX_PAGES),
}).strict();
export type ProductMapPages = z.infer<typeof productMapPagesSchema>;

export const productMapFeatureSchema = z.object({
  id: featureIdSchema,
  name: boundedText(240),
  purpose: boundedText(2_000),
  userRole: boundedText(160),
  entry: boundedText(1_000),
  action: boundedText(2_000),
  result: boundedText(1_000),
  states: stateListSchema,
  actionDefinitions: z.array(productMapActionDefinitionSchema).min(1).max(20).optional(),
  stateDefinitions: z.array(productMapStateDefinitionSchema).min(1).max(20).optional(),
  dependencies: z.array(boundedText(240)).max(20),
  pageIds: z.array(pageIdSchema).max(PRODUCT_MAP_MAX_PAGES),
  moduleId: moduleIdSchema,
  priority: prioritySchema,
  evidenceStatus: productMapEvidenceStatusSchema,
  citations: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => validateEvidenceStatus({ evidenceStatus: value.evidenceStatus, sourceRefs: value.citations }, context));
export type ProductMapFeature = z.infer<typeof productMapFeatureSchema>;

export const productMapFeaturesSchema = z.object({
  features: z.array(productMapFeatureSchema).max(PRODUCT_MAP_MAX_FEATURES),
}).strict();
export type ProductMapFeatures = z.infer<typeof productMapFeaturesSchema>;

export const productMapRiskSchema = z.object({
  id: riskIdSchema,
  type: z.literal("risk"),
  description: boundedText(2_000),
  impactObjects: z.array(boundedText(240)).min(1).max(20),
  impact: z.enum(["high", "medium", "low"]),
  suggestedConfirmation: optionalBoundedText(1_000),
  priority: z.enum(["P0", "P1", "P2"]),
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict();

export const productMapQuestionSchema = z.object({
  id: questionIdSchema,
  type: z.literal("question"),
  description: boundedText(2_000),
  impactObjects: z.array(boundedText(240)).min(1).max(20),
  impact: z.enum(["high", "medium", "low"]),
  suggestedConfirmer: optionalBoundedText(1_000),
  priority: z.enum(["P0", "P1", "P2"]),
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict();

export const productMapRisksQuestionsSchema = z.object({
  risks: z.array(productMapRiskSchema).max(40),
  questions: z.array(productMapQuestionSchema).max(40),
}).strict();
export type ProductMapRisksQuestions = z.infer<typeof productMapRisksQuestionsSchema>;

export const productMapQualityCheckSchema = z.object({
  id: z.enum(PRODUCT_MAP_QUALITY_CHECK_IDS),
  condition: boundedText(500),
  result: z.enum(["PASS", "待确认"]),
  note: boundedText(2_000),
  relatedIds: z.array(z.string().regex(/^(G|J|M|P|F|R|Q)[1-9][0-9]?$/)).max(40),
}).strict();

export const productMapQualitySchema = z.object({
  checks: z.array(productMapQualityCheckSchema).length(PRODUCT_MAP_QUALITY_CHECK_IDS.length),
  overall: z.enum(["通过", "需确认", "阻塞"]),
  blockers: z.array(boundedText(1_000)).max(20),
}).strict().superRefine((value, context) => {
  const ids = new Set(value.checks.map((check) => check.id));
  if (ids.size !== PRODUCT_MAP_QUALITY_CHECK_IDS.length) {
    context.addIssue({ code: "custom", path: ["checks"], message: "quality checks must contain each check exactly once" });
  }
  const hasPending = value.checks.some((check) => check.result === "待确认");
  if (value.overall === "通过" && (hasPending || value.blockers.length > 0)) {
    context.addIssue({ code: "custom", message: "overall PASS cannot contain pending checks or blockers" });
  }
  if (value.overall === "阻塞" && value.blockers.length === 0) {
    context.addIssue({ code: "custom", path: ["blockers"], message: "blocked quality result requires a blocker" });
  }
});
export type ProductMapQuality = z.infer<typeof productMapQualitySchema>;

export const productMapCompletenessFieldSchema = z.object({
  field: z.enum(PRODUCT_MAP_COVERAGE_FIELDS),
  status: z.enum(["present", "missing", "conflict", "irrelevant"]),
  evidenceCount: z.number().int().min(0).max(PRODUCT_MAP_MAX_EVIDENCE_ITEMS),
  reliableEvidenceCount: z.number().int().min(0).max(PRODUCT_MAP_MAX_EVIDENCE_ITEMS),
  summary: optionalBoundedText(1_000),
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
}).strict().superRefine((value, context) => {
  if (value.reliableEvidenceCount > value.evidenceCount) {
    context.addIssue({ code: "custom", path: ["reliableEvidenceCount"], message: "reliable evidence cannot exceed evidence count" });
  }
  if (value.status === "present" && value.reliableEvidenceCount === 0) {
    context.addIssue({ code: "custom", path: ["reliableEvidenceCount"], message: "present field requires reliable evidence" });
  }
});
export type ProductMapCompletenessField = z.infer<typeof productMapCompletenessFieldSchema>;

export const productMapConflictSchema = z.object({
  id: riskIdSchema,
  description: boundedText(2_000),
  sourceRefs: z.array(sourceIdSchema).min(2).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  resolution: z.enum(["unresolved", "preferred_source", "user_confirmed"]),
}).strict();
export type ProductMapConflict = z.infer<typeof productMapConflictSchema>;

export const productMapCompletenessSchema = z.object({
  status: z.enum(["sufficient", "insufficient"]),
  accessibleSourceCount: z.number().int().min(0).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  retrievedEvidenceCount: z.number().int().min(0).max(PRODUCT_MAP_MAX_EVIDENCE_ITEMS),
  reliableEvidenceCount: z.number().int().min(0).max(PRODUCT_MAP_MAX_EVIDENCE_ITEMS),
  fields: z.array(productMapCompletenessFieldSchema).length(PRODUCT_MAP_COVERAGE_FIELDS.length),
  missingFields: z.array(z.enum(PRODUCT_MAP_COVERAGE_FIELDS)).max(PRODUCT_MAP_COVERAGE_FIELDS.length),
  conflicts: z.array(productMapConflictSchema).max(40),
  irrelevantRetrieval: z.boolean(),
  unparsedSourceIds: z.array(identifierSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  reasons: z.array(boundedText(500)).max(20),
  limitedEvidence: z.boolean(),
  modelJudgment: z.object({
    status: z.enum(["sufficient", "insufficient"]),
    missingFields: z.array(z.enum(PRODUCT_MAP_COVERAGE_FIELDS)).max(PRODUCT_MAP_COVERAGE_FIELDS.length),
    conflictIds: z.array(riskIdSchema).max(40),
    reasons: z.array(boundedText(500)).max(20),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const fieldIds = new Set(value.fields.map((field) => field.field));
  if (fieldIds.size !== PRODUCT_MAP_COVERAGE_FIELDS.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "completeness matrix must contain each field exactly once" });
  }
  const expectedMissing = value.fields.filter((field) => field.status !== "present").map((field) => field.field).sort();
  if (JSON.stringify([...value.missingFields].sort()) !== JSON.stringify(expectedMissing)) {
    context.addIssue({ code: "custom", path: ["missingFields"], message: "missing fields must match the coverage matrix" });
  }
  const intrinsicallyInsufficient = value.retrievedEvidenceCount === 0
    || value.reliableEvidenceCount < 1
    || value.fields.filter((field) => field.reliableEvidenceCount > 0).length < 4
    || value.fields.some((field) => (field.field === "business_goal" || field.field === "core_requirements") && field.status !== "present")
    || value.conflicts.length > 0
    || value.irrelevantRetrieval
    || value.unparsedSourceIds.length > 0;
  if (intrinsicallyInsufficient && value.status !== "insufficient") {
    context.addIssue({ code: "custom", path: ["status"], message: "coverage conditions require insufficient status" });
  }
});
export type ProductMapCompleteness = z.infer<typeof productMapCompletenessSchema>;
export type ProductMapModelCompleteness = NonNullable<ProductMapCompleteness["modelJudgment"]>;
export const productMapCompletenessCheckSchema = productMapCompletenessSchema;

/**
 * Deterministic completeness gate used before any model step.  It intentionally
 * has no model/provider dependency, making the insufficient-evidence dialog
 * reproducible in CI and safe to retry.
 */
export function evaluateProductMapCompleteness(input: {
  accessibleSourceCount: number;
  retrievedEvidenceCount: number;
  reliableEvidenceCount: number;
  fields: ProductMapCompletenessField[];
  conflicts?: ProductMapConflict[];
  irrelevantRetrieval?: boolean;
  unparsedSourceIds?: string[];
  limitedEvidence?: boolean;
  modelJudgment?: ProductMapModelCompleteness;
}): ProductMapCompleteness {
  const fields = productMapCompletenessSchema.shape.fields.parse(input.fields);
  const conflicts = (input.conflicts ?? []).map((conflict) => productMapConflictSchema.parse(conflict));
  const irrelevantRetrieval = input.irrelevantRetrieval === true;
  const unparsedSourceIds = (input.unparsedSourceIds ?? []).map((id) => identifierSchema.parse(id));
  const missingFields = fields.filter((field) => field.status !== "present").map((field) => field.field);
  const reasons: string[] = [];
  if (input.retrievedEvidenceCount === 0) reasons.push("没有找到相关资料");
  if (missingFields.includes("business_goal")) reasons.push("缺少业务目标证据");
  if (missingFields.includes("core_requirements")) reasons.push("缺少核心需求证据");
  if (input.reliableEvidenceCount < 1) reasons.push("没有可靠证据");
  if (fields.filter((field) => field.reliableEvidenceCount > 0).length < 4) reasons.push("六项覆盖中有可靠证据的主题少于 4 项");
  if (conflicts.length > 0) reasons.push("资料之间存在关键冲突");
  if (irrelevantRetrieval) reasons.push("检索结果与本次需求明显无关");
  if (unparsedSourceIds.length > 0) reasons.push("部分资料尚未完成解析");
  const status = reasons.length > 0 ? "insufficient" : "sufficient";
  return productMapCompletenessSchema.parse({
    status,
    accessibleSourceCount: input.accessibleSourceCount,
    retrievedEvidenceCount: input.retrievedEvidenceCount,
    reliableEvidenceCount: input.reliableEvidenceCount,
    fields,
    missingFields,
    conflicts,
    irrelevantRetrieval,
    unparsedSourceIds,
    reasons,
    limitedEvidence: input.limitedEvidence === true,
    ...(input.modelJudgment ? { modelJudgment: input.modelJudgment } : {}),
  });
}

/**
 * The independent review is model-assisted, but whether weak/conflicting
 * evidence can be called "passed" is a server-owned decision.  This function
 * preserves the model's useful review notes while deterministically binding
 * its evidence check and overall result to the trusted coverage matrix.
 */
export function bindProductMapQualityToCompleteness(
  quality: ProductMapQuality,
  completeness: ProductMapCompleteness,
): ProductMapQuality {
  const parsedQuality = productMapQualitySchema.parse(quality);
  const parsedCompleteness = productMapCompletenessSchema.parse(completeness);
  const requiresConfirmation = parsedCompleteness.status === "insufficient"
    || parsedCompleteness.limitedEvidence
    || parsedCompleteness.conflicts.length > 0;
  if (!requiresConfirmation) return parsedQuality;
  const reasons = [
    ...parsedCompleteness.reasons,
    ...parsedCompleteness.conflicts.map((conflict) => conflict.description),
  ];
  const evidenceNote = reasons.length
    ? `可信证据检查待确认：${reasons.join("；")}`.slice(0, 2_000)
    : "可信证据检查待确认：当前以有限证据继续。";
  return productMapQualitySchema.parse({
    ...parsedQuality,
    checks: parsedQuality.checks.map((check) => check.id === "evidence_traceability"
      ? { ...check, result: "待确认" as const, note: evidenceNote }
      : check),
    overall: parsedQuality.overall === "阻塞" ? "阻塞" : "需确认",
  });
}

export const productMapConfigInputSchema = z.object({
  projectId: identifierSchema,
  selectedSourceIds: z.array(identifierSchema).max(PRODUCT_MAP_MAX_SELECTED_SOURCES),
  contextReferences: z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("project"),
      projectId: identifierSchema,
      label: boundedText(200),
    }).strict(),
    z.object({
      type: z.literal("document"),
      documentId: identifierSchema,
      documentVersionId: identifierSchema.optional(),
      sourceType: z.enum(["project", "company"]),
      label: boundedText(200),
    }).strict(),
  ])).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES).optional().default([]),
  retrievalInstruction: optionalBoundedText(PRODUCT_MAP_MAX_RETRIEVAL_INSTRUCTION),
  userInput: optionalBoundedText(PRODUCT_MAP_MAX_USER_INPUT),
  conversationId: identifierSchema.optional(),
  includeConversationContext: z.boolean().optional().default(false),
  /** Keep a newly-created run paused until an optional first attachment is
   * explicitly stored in the project knowledge space. */
  initialAttachment: z.boolean().optional().default(false),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict().superRefine((value, context) => {
  if (new Set(value.selectedSourceIds).size !== value.selectedSourceIds.length) {
    context.addIssue({ code: "custom", path: ["selectedSourceIds"], message: "duplicate source ids are not allowed" });
  }
  if (value.selectedSourceIds.length === 0 && !value.retrievalInstruction && !value.userInput) {
    // Empty selection is valid: the server will search all authorized project
    // material.  Keep this branch explicit to document that contract.
    return;
  }
  if (value.retrievalInstruction?.trim() === "" && value.selectedSourceIds.length === 0 && !value.userInput) {
    context.addIssue({ code: "custom", path: ["retrievalInstruction"], message: "retrieval instruction cannot be blank" });
  }
});
export type ProductMapConfigInput = z.infer<typeof productMapConfigInputSchema>;
// Short aliases make the contract convenient for route code while retaining
// the explicit config/run distinction above.
export const productMapInputSchema = productMapConfigInputSchema;
export type ProductMapInput = ProductMapConfigInput;

/** Server-enriched input persisted with a run; never accept these fields from a browser. */
export const productMapRunInputSchema = productMapConfigInputSchema.extend({
  skillId: z.literal(PRODUCT_MAP_SKILL_ID),
  skillVersion: z.literal(PRODUCT_MAP_SKILL_VERSION),
  uploadedSourceIds: z.array(identifierSchema).max(PRODUCT_MAP_MAX_UPLOADED_SOURCES),
  limitedEvidence: z.boolean(),
  createdBy: identifierSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.uploadedSourceIds).size !== value.uploadedSourceIds.length) {
    context.addIssue({ code: "custom", path: ["uploadedSourceIds"], message: "duplicate uploaded source ids are not allowed" });
  }
});
export type ProductMapRunInput = z.infer<typeof productMapRunInputSchema>;
export const productMapWorkflowInputSchema = productMapRunInputSchema;

export const productMapStepOutputSchema = z.object({
  stepId: z.enum(PRODUCT_MAP_STEP_IDS),
  stepVersion: z.literal(PRODUCT_MAP_SCHEMA_VERSION),
  status: z.enum(["completed", "needs_input", "failed"]),
  output: z.unknown(),
  sourceRefs: z.array(sourceIdSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  outputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ProductMapStepOutput = z.infer<typeof productMapStepOutputSchema>;

export const productMapStructureIssueSchema = z.object({
  issue: boundedText(160),
  severity: z.enum(["error", "warning"]),
  evidence: z.array(boundedText(240)).max(40),
  suggestion: boundedText(1_000),
}).strict();
export type ProductMapStructureIssue = z.infer<typeof productMapStructureIssueSchema>;

export const productMapStructureReviewSchema = z.object({
  version: z.literal("pm-design-lint-v1"),
  checkedAt: z.string().datetime({ offset: true }),
  passed: z.boolean(),
  issues: z.array(productMapStructureIssueSchema).max(100),
}).strict().superRefine((value, context) => {
  const expected = !value.issues.some((issue) => issue.severity === "error");
  if (value.passed !== expected) {
    context.addIssue({ code: "custom", path: ["passed"], message: "lint pass flag must match error issues" });
  }
});
export type ProductMapStructureReview = z.infer<typeof productMapStructureReviewSchema>;

export const productMapFinalStepSummarySchema = z.object({
  artifactSchemaVersion: z.literal(PRODUCT_MAP_SCHEMA_VERSION),
  structureIssueCount: z.number().int().min(0).max(100),
  structurePassed: z.boolean(),
}).strict();

export const productMapArtifactSchema = z.object({
  schemaVersion: z.literal(PRODUCT_MAP_SCHEMA_VERSION),
  integrityNote: boundedText(2_000),
  completeness: productMapCompletenessSchema,
  materialInventory: productMapEvidenceInventorySchema,
  projectUnderstanding: productMapProjectUnderstandingSchema,
  goals: productMapGoalsSchema,
  userPath: productMapUserPathSchema,
  productMap: productMapStructureSchema,
  pages: productMapPagesSchema,
  features: productMapFeaturesSchema,
  risksAndQuestions: productMapRisksQuestionsSchema,
  quality: productMapQualitySchema,
  citations: z.array(productMapSourceReferenceSchema).max(PRODUCT_MAP_MAX_SOURCE_REFERENCES),
  stepOutputs: z.array(productMapStepOutputSchema).length(PRODUCT_MAP_STEP_IDS.length),
  handoffSummary: z.object({
    projectPositioning: boundedText(2_000),
    minimumPath: boundedText(2_000),
    mustPages: z.array(pageIdSchema).max(PRODUCT_MAP_MAX_PAGES),
    mustFeatures: z.array(featureIdSchema).max(PRODUCT_MAP_MAX_FEATURES),
    blockers: z.array(boundedText(1_000)).max(20),
    downstreamFiles: z.array(boundedText(240)).max(20),
  }).strict(),
  analysisContract: productMapAnalysisContractSchema,
  structureReview: productMapStructureReviewSchema,
}).strict().superRefine((value, context) => {
  const pageIds = new Set(value.pages.pages.map((page) => page.id));
  const featureIds = new Set(value.features.features.map((feature) => feature.id));
  const moduleIds = new Set(value.productMap.modules.map((module) => module.id));
  const goalIds = new Set(value.goals.goals.map((goal) => goal.id));
  const citationIds = new Set(value.citations.map((citation) => citation.sourceId));
  const evidenceById = new Map(value.materialInventory.evidence.map((evidence) => [evidence.id, evidence]));
  const boundEvidenceIds = new Set<string>();
  const pagesById = new Map(value.pages.pages.map((page) => [page.id, page]));
  const featuresById = new Map(value.features.features.map((feature) => [feature.id, feature]));
  const surfaceIds = new Set<string>();
  const featureSurfaceIds = new Map<string, Set<string>>();
  const actionIds = new Set<string>();
  const stateIds = new Set<string>();
  const knownSourceIds = new Set(value.citations.map((citation) => citation.sourceId));
  const checkKnownSources = (refs: string[], path: Array<string | number>) => {
    for (const ref of refs) {
      if (!knownSourceIds.has(ref)) context.addIssue({ code: "custom", path, message: `unknown source reference: ${ref}` });
    }
  };
  if (citationIds.size !== value.citations.length) context.addIssue({ code: "custom", path: ["citations"], message: "citation source ids must be unique" });
  for (const [citationIndex, citation] of value.citations.entries()) {
    for (const [bindingIndex, binding] of citation.evidenceBindings.entries()) {
      const evidence = evidenceById.get(binding.evidenceId);
      if (!evidence
        || evidence.sourceId !== citation.sourceId
        || evidence.versionId !== binding.versionId
        || evidence.chunkId !== binding.chunkId
        || evidence.locator !== binding.locator
        || evidence.excerptDigest !== binding.excerptDigest) {
        context.addIssue({
          code: "custom",
          path: ["citations", citationIndex, "evidenceBindings", bindingIndex],
          message: "citation binding must match the trusted evidence inventory",
        });
      }
      if (boundEvidenceIds.has(binding.evidenceId)) {
        context.addIssue({ code: "custom", path: ["citations", citationIndex, "evidenceBindings"], message: "evidence binding must not appear in multiple citations" });
      }
      boundEvidenceIds.add(binding.evidenceId);
    }
  }
  for (const evidence of value.materialInventory.evidence) {
    if (!boundEvidenceIds.has(evidence.id)) {
      context.addIssue({ code: "custom", path: ["citations"], message: `trusted evidence is missing a citation binding: ${evidence.id}` });
    }
  }
  const expectedStepIds = [...PRODUCT_MAP_STEP_IDS];
  value.stepOutputs.forEach((step, index) => {
    if (step.stepId !== expectedStepIds[index]) {
      context.addIssue({ code: "custom", path: ["stepOutputs", index, "stepId"], message: `step output must be ${expectedStepIds[index]}` });
    }
  });
  const requiresEvidenceConfirmation = value.completeness.status === "insufficient"
    || value.completeness.limitedEvidence
    || value.completeness.conflicts.length > 0
    || value.analysisContract.evidenceCoverage.conflict > 0;
  const evidenceCheck = value.quality.checks.find((check) => check.id === "evidence_traceability");
  if (requiresEvidenceConfirmation && (value.quality.overall === "通过" || evidenceCheck?.result !== "待确认")) {
    context.addIssue({ code: "custom", path: ["quality"], message: "quality must reflect trusted incomplete or conflicting evidence" });
  }
  if (pageIds.size !== value.pages.pages.length) context.addIssue({ code: "custom", path: ["pages"], message: "page ids must be unique" });
  if (featureIds.size !== value.features.features.length) context.addIssue({ code: "custom", path: ["features"], message: "feature ids must be unique" });
  if (moduleIds.size !== value.productMap.modules.length) context.addIssue({ code: "custom", path: ["productMap"], message: "module ids must be unique" });
  for (const productModule of value.productMap.modules) {
    checkKnownSources(productModule.citations, ["productMap", productModule.id, "citations"]);
    for (const surface of productModule.surfaces) {
      if (surfaceIds.has(surface.stableId)) context.addIssue({ code: "custom", path: ["productMap"], message: `surface stable id is duplicated: ${surface.stableId}` });
      surfaceIds.add(surface.stableId);
      checkKnownSources(surface.citations, ["productMap", surface.stableId, "citations"]);
      if (surface.kind === "page") {
        const page = pagesById.get(surface.stableId);
        if (!page) context.addIssue({ code: "custom", path: ["productMap"], message: `surface references unknown page: ${surface.stableId}` });
        else if (page.moduleId !== productModule.id || page.name !== surface.name) context.addIssue({ code: "custom", path: ["productMap"], message: `page surface metadata mismatch: ${surface.stableId}` });
      }
      for (const mapped of surface.features) {
        const feature = featuresById.get(mapped.featureId);
        if (!feature) {
          context.addIssue({ code: "custom", path: ["productMap"], message: `surface references unknown feature: ${mapped.featureId}` });
          continue;
        }
        if (feature.moduleId !== productModule.id) context.addIssue({ code: "custom", path: ["productMap"], message: `feature module mismatch: ${mapped.featureId}` });
        if (surface.kind === "page" && !feature.pageIds.includes(surface.stableId)) context.addIssue({ code: "custom", path: ["productMap"], message: `feature does not declare its page surface: ${mapped.featureId}` });
        if (feature.actionDefinitions && mapped.actionIds.some((id) => !feature.actionDefinitions!.some((action) => action.id === id))) {
          context.addIssue({ code: "custom", path: ["productMap"], message: `mapped action is not defined by feature: ${mapped.featureId}` });
        }
        if (feature.stateDefinitions && mapped.stateIds.some((id) => !feature.stateDefinitions!.some((state) => state.id === id))) {
          context.addIssue({ code: "custom", path: ["productMap"], message: `mapped state is not defined by feature: ${mapped.featureId}` });
        }
        const mappedSurfaces = featureSurfaceIds.get(mapped.featureId) ?? new Set<string>();
        mappedSurfaces.add(surface.stableId);
        featureSurfaceIds.set(mapped.featureId, mappedSurfaces);
        for (const actionId of mapped.actionIds) {
          if (actionIds.has(actionId)) context.addIssue({ code: "custom", path: ["productMap"], message: `action stable id is duplicated: ${actionId}` });
          actionIds.add(actionId);
        }
        for (const stateId of mapped.stateIds) {
          if (stateIds.has(stateId)) context.addIssue({ code: "custom", path: ["productMap"], message: `state stable id is duplicated: ${stateId}` });
          stateIds.add(stateId);
        }
      }
    }
  }
  for (const page of value.pages.pages) {
    if (!surfaceIds.has(page.id)) context.addIssue({ code: "custom", path: ["pages"], message: `page is missing from product map hierarchy: ${page.id}` });
  }
  for (const feature of value.features.features) {
    if (!featureSurfaceIds.has(feature.id)) context.addIssue({ code: "custom", path: ["features"], message: `feature is missing from product map hierarchy: ${feature.id}` });
  }
  for (const step of value.userPath.steps) {
    for (const pageId of step.pageIds) if (!pageIds.has(pageId)) context.addIssue({ code: "custom", path: ["userPath"], message: `journey references unknown page: ${pageId}` });
    for (const goalId of step.goalIds) if (!goalIds.has(goalId)) context.addIssue({ code: "custom", path: ["userPath"], message: `journey references unknown goal: ${goalId}` });
  }
  for (const page of value.pages.pages) {
    if (!moduleIds.has(page.moduleId)) context.addIssue({ code: "custom", path: ["pages"], message: `page references unknown module: ${page.moduleId}` });
    for (const goalId of page.goalIds) if (!goalIds.has(goalId)) context.addIssue({ code: "custom", path: ["pages"], message: `page references unknown goal: ${goalId}` });
    const ownerModule = value.productMap.modules.find((candidate) => candidate.id === page.moduleId);
    if (ownerModule && page.goalIds.some((goalId) => !ownerModule.goalIds.includes(goalId))) context.addIssue({ code: "custom", path: ["pages"], message: `page goal is not declared by its module: ${page.id}` });
    checkKnownSources(page.citations, ["pages", page.id, "citations"]);
  }
  for (const feature of value.features.features) {
    if (!moduleIds.has(feature.moduleId)) context.addIssue({ code: "custom", path: ["features"], message: `feature references unknown module: ${feature.moduleId}` });
    for (const pageId of feature.pageIds) if (!pageIds.has(pageId)) context.addIssue({ code: "custom", path: ["features"], message: `feature references unknown page: ${pageId}` });
    const ownerModule = value.productMap.modules.find((candidate) => candidate.id === feature.moduleId);
    if (ownerModule && feature.pageIds.some((pageId) => pagesById.get(pageId)?.moduleId !== feature.moduleId)) context.addIssue({ code: "custom", path: ["features"], message: `feature page belongs to another module: ${feature.id}` });
    checkKnownSources(feature.citations, ["features", feature.id, "citations"]);
    for (const action of feature.actionDefinitions ?? []) checkKnownSources(action.citations, ["features", feature.id, "actionDefinitions"]);
    for (const state of feature.stateDefinitions ?? []) checkKnownSources(state.citations, ["features", feature.id, "stateDefinitions"]);
  }
  const analysisSourceIds = new Set(value.analysisContract.sources.map((source) => source.id));
  if ([...knownSourceIds].some((id) => !analysisSourceIds.has(id))) {
    context.addIssue({ code: "custom", path: ["analysisContract", "sources"], message: "every trusted citation must have an analysis source" });
  }
  for (const source of value.analysisContract.sources) {
    for (const evidenceId of source.citationIds) {
      if (evidenceById.get(evidenceId)?.sourceId !== source.id) context.addIssue({ code: "custom", path: ["analysisContract", "sources", source.id, "citationIds"], message: `analysis citation is not bound to source: ${evidenceId}` });
    }
  }
  const goalLinks = new Map(value.analysisContract.goalLinks.map((link) => [`${link.businessGoalId}:${link.userGoalId}`, link]));
  for (const goal of value.goals.goals) {
    if (goal.businessGoalId && goal.userGoalId && !goalLinks.has(`${goal.businessGoalId}:${goal.userGoalId}`)) {
      context.addIssue({ code: "custom", path: ["goals", goal.id], message: `goal does not have a PM goal link: ${goal.id}` });
    }
  }
  const artifactSourceRefs: string[][] = [
    ...value.projectUnderstanding.targetUsers.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.useCases.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.businessStakeholders.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.technicalStakeholders.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.businessGoals.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.desiredUserBehaviors.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.businessOutcomes.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.externalSystems.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.thirdParties.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.confirmedDecisions.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.uncertainties.map((item) => item.sourceRefs),
    ...value.goals.goals.map((item) => item.sourceRefs),
    ...value.userPath.steps.map((item) => item.sourceRefs),
    ...value.risksAndQuestions.risks.map((item) => item.sourceRefs),
    ...value.risksAndQuestions.questions.map((item) => item.sourceRefs),
  ];
  artifactSourceRefs.push(
    value.projectUnderstanding.projectName.sourceRefs,
    value.projectUnderstanding.projectBackground.sourceRefs,
    value.projectUnderstanding.oneLinePositioning.sourceRefs,
    value.projectUnderstanding.platformContext.sourceRefs,
    value.projectUnderstanding.projectPeriod.sourceRefs,
    ...value.projectUnderstanding.inScope.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.outOfScope.map((item) => item.sourceRefs),
    ...value.projectUnderstanding.knownConstraints.map((item) => item.sourceRefs),
  );
  artifactSourceRefs.forEach((refs, index) => checkKnownSources(refs, ["sourceRefs", index]));
  for (const id of value.handoffSummary.mustPages) if (!pageIds.has(id)) context.addIssue({ code: "custom", path: ["handoffSummary", "mustPages"], message: `unknown must page: ${id}` });
  for (const id of value.handoffSummary.mustFeatures) if (!featureIds.has(id)) context.addIssue({ code: "custom", path: ["handoffSummary", "mustFeatures"], message: `unknown must feature: ${id}` });
});
export type ProductMapArtifact = z.infer<typeof productMapArtifactSchema>;
export const productMapOutputSchema = productMapArtifactSchema;
export type ProductMapOutput = ProductMapArtifact;

export const PRODUCT_MAP_STEP_SCHEMAS = {
  evidence_inventory: productMapEvidenceInventorySchema,
  project_understanding: productMapProjectUnderstandingSchema,
  goals_and_behaviors: productMapGoalsSchema,
  user_path: productMapUserPathSchema,
  product_map: productMapStructureSchema,
  pages_and_features: z.object({ pages: productMapPagesSchema.shape.pages, features: productMapFeaturesSchema.shape.features }).strict(),
  independent_review: productMapQualitySchema,
  final_artifact: productMapFinalStepSummarySchema,
} as const;

/** Validate a persisted step envelope and then its step-specific JSON output. */
export function validateProductMapStepOutput(value: unknown): boolean {
  const parsed = productMapStepOutputSchema.safeParse(value);
  if (!parsed.success) return false;
  return PRODUCT_MAP_STEP_SCHEMAS[parsed.data.stepId].safeParse(parsed.data.output).success;
}

export function describeProductMapSchemaFailure(value: unknown, schema: z.ZodTypeAny = productMapArtifactSchema): string {
  const parsed = schema.safeParse(value);
  if (parsed.success) return "PRODUCT_MAP_SCHEMA_INVALID";
  const issue = parsed.error.issues[0];
  const path = issue?.path.map((part) => String(part).replace(/[^a-zA-Z0-9_-]/g, "_")).join("_") || "root";
  return `PRODUCT_MAP_SCHEMA_${path}`.slice(0, 96);
}

const productMapStructureLintInputSchema = z.object({
  productMap: productMapStructureSchema,
  pages: productMapPagesSchema,
  features: productMapFeaturesSchema,
  userPath: productMapUserPathSchema,
}).passthrough();

/** Deterministic step-7 PM/Design lint. It stores only issues, not reasoning. */
export function runProductMapStructureLint(value: unknown): ProductMapStructureIssue[] {
  const artifactResult = productMapArtifactSchema.safeParse(value);
  const structuralResult = artifactResult.success ? null : productMapStructureLintInputSchema.safeParse(value);
  const artifact = artifactResult.success ? artifactResult.data : structuralResult?.success ? structuralResult.data : null;
  if (!artifact) return [{ issue: "structure_schema_invalid", severity: "error", evidence: [], suggestion: "修复结构化页面、功能、路径和层级输出后重试。" }];
  const issues: ProductMapStructureIssue[] = [];
  const modules = artifact.productMap.modules;
  const pages = new Map(artifact.pages.pages.map((page) => [page.id, page]));
  const features = new Map(artifact.features.features.map((feature) => [feature.id, feature]));
  const nodes = new Set<string>();
  for (const mapModule of modules) {
    if (!mapModule.surfaces.length) issues.push({ issue: "module_without_surface", severity: "error", evidence: [mapModule.id], suggestion: "为模块补充有业务意义的页面或承载面。" });
    for (const surface of mapModule.surfaces) {
      if (nodes.has(surface.stableId)) issues.push({ issue: "duplicate_stable_id", severity: "error", evidence: [surface.stableId], suggestion: "为页面或承载面使用唯一 stableId。" });
      nodes.add(surface.stableId);
    }
  }
  for (const page of pages.values()) {
    const describedStates = [...page.states, ...page.exceptionStates].join(" ").toLowerCase();
    const requiredStates = ["empty", "loading", "success", "error", "permission denied"];
    if (requiredStates.some((state) => !describedStates.includes(state))) {
      issues.push({ issue: "page_states_incomplete", severity: "warning", evidence: [page.id], suggestion: "至少说明空、加载、成功、失败和无权限状态。" });
    }
  }
  for (const feature of features.values()) {
    const inHierarchy = modules.some((module) => module.surfaces.some((surface) => surface.features.some((item) => item.featureId === feature.id)));
    if (!inHierarchy) issues.push({ issue: "feature_without_surface", severity: "error", evidence: [feature.id], suggestion: "将功能绑定到实际页面或承载面。" });
    if (!feature.actionDefinitions?.length || !feature.stateDefinitions?.length) {
      issues.push({ issue: "feature_action_state_definitions_missing", severity: "warning", evidence: [feature.id], suggestion: "为功能补充带稳定 A#/ST#、触发和结果的 Action/State 定义。" });
    }
  }
  const pageIds = new Set(pages.keys());
  const usedPageIds = new Set<string>();
  for (const step of artifact.userPath.steps) {
    for (const pageId of step.pageIds) {
      usedPageIds.add(pageId);
      if (!pageIds.has(pageId)) issues.push({ issue: "flow_page_missing", severity: "error", evidence: [step.id, pageId], suggestion: "修正用户路径中的页面跳转。" });
    }
  }
  for (const page of pages.values()) {
    if (!usedPageIds.has(page.id)) issues.push({ issue: "page_not_used_by_flow", severity: "warning", evidence: [page.id], suggestion: "将页面关联到用户路径，或确认它是否应保留。" });
  }
  const pageNames = new Map<string, string>();
  for (const page of pages.values()) {
    const normalized = page.name.trim().toLowerCase();
    const previousId = pageNames.get(normalized);
    if (previousId) issues.push({ issue: "duplicate_page", severity: "warning", evidence: [previousId, page.id], suggestion: "合并重复页面或明确不同职责。" });
    pageNames.set(normalized, page.id);
  }
  const featureNames = new Map<string, string>();
  for (const feature of features.values()) {
    const normalized = feature.name.trim().toLowerCase();
    const previousId = featureNames.get(normalized);
    if (previousId) issues.push({ issue: "duplicate_feature", severity: "warning", evidence: [previousId, feature.id], suggestion: "合并同义功能或明确不同结果。" });
    featureNames.set(normalized, feature.id);
  }
  if (artifactResult.success) {
    const fullArtifact = artifactResult.data;
    const statusCounts = fullArtifact.analysisContract.evidenceCoverage;
    if (fullArtifact.completeness.status === "insufficient" && fullArtifact.quality.overall === "通过") {
      issues.push({ issue: "insufficient_evidence_marked_pass", severity: "error", evidence: fullArtifact.completeness.missingFields, suggestion: "保留 MISSING/CONFLICT，并将质量状态改为需确认。" });
    }
    if (statusCounts.conflict > 0 && fullArtifact.quality.overall === "通过") {
      issues.push({ issue: "analysis_conflict_marked_pass", severity: "error", evidence: [], suggestion: "保留可信来源之间的冲突，并将质量状态降级为需确认。" });
    }
    if (statusCounts.confirmed > 0 && fullArtifact.citations.length === 0) {
      issues.push({ issue: "confirmed_without_citation", severity: "error", evidence: [], suggestion: "为 CONFIRMED 结论绑定有效引用。" });
    }
    const goalLinkKeys = new Set(fullArtifact.analysisContract.goalLinks.map((link) => `${link.businessGoalId}:${link.userGoalId}`));
    for (const goal of fullArtifact.goals.goals) {
      if (!goal.businessGoalId || !goal.userGoalId) {
        issues.push({ issue: "goal_business_user_link_missing", severity: "warning", evidence: [goal.id], suggestion: "为 G# 关联 businessGoalId 与 userGoalId，避免将目标混同为功能方案。" });
      } else if (!goalLinkKeys.has(`${goal.businessGoalId}:${goal.userGoalId}`)) {
        issues.push({ issue: "goal_business_user_link_invalid", severity: "error", evidence: [goal.id], suggestion: "让 G# 的 businessGoalId/userGoalId 对应 analysisContract.goalLinks。" });
      }
    }
  }
  return issues;
}

export function productMapConfidenceLabel(confidence: ProductMapConfidence): "[已知]" | "[推断]" | "[待确认]" {
  return confidence === "confirmed" ? "[已知]" : confidence === "inferred" ? "[推断]" : "[待确认]";
}

export const PRODUCT_MAP_ALLOWED_TRANSITIONS: Readonly<Record<ProductMapRunState, readonly ProductMapRunState[]>> = {
  queued: ["checking_sources", "indexing", "retrieving", "cancelled", "failed"],
  checking_sources: ["needs_input", "retrieving", "uploading", "failed", "cancelled"],
  needs_input: ["checking_sources", "uploading", "retrieving", "cancelled", "failed"],
  uploading: ["indexing", "failed", "cancelled"],
  indexing: ["checking_sources", "retrieving", "failed", "cancelled"],
  retrieving: ["running", "needs_input", "failed", "cancelled"],
  running: ["reviewing", "failed", "cancelled"],
  reviewing: ["completed", "published", "failed", "unknown", "cancelled"],
  unknown: ["checking_sources", "uploading", "cancelled"],
  completed: [],
  published: [],
  failed: ["checking_sources", "uploading", "cancelled"],
  cancelled: [],
};

export function isProductMapStateTransitionAllowed(from: ProductMapRunState, to: ProductMapRunState): boolean {
  return PRODUCT_MAP_ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertProductMapStateTransition(from: ProductMapRunState, to: ProductMapRunState): void {
  if (!isProductMapStateTransitionAllowed(from, to)) {
    throw new Error(`PRODUCT_MAP_INVALID_STATE_TRANSITION:${from}->${to}`);
  }
}
