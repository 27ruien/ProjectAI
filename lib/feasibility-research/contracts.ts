import { z } from "zod";
import { requirementAnalysisPackSchema } from "@/lib/requirement-analyst";

export const FEASIBILITY_RESEARCH_SKILL_ID = "project-feasibility-research";
export const FEASIBILITY_RESEARCH_SKILL_VERSION = "0.1.0";
export const FEASIBILITY_RESEARCH_INPUT_SCHEMA_VERSION =
  "projectai-feasibility-research-input-v1";
export const FEASIBILITY_RESEARCH_PLAN_SCHEMA_VERSION =
  "projectai-feasibility-research-plan-v1";
export const FEASIBILITY_RESEARCH_REPORT_SCHEMA_VERSION =
  "projectai-feasibility-research-report-v1";

export const FEASIBILITY_RESEARCH_DIMENSIONS = [
  "product_experience",
  "technical",
  "vendor_market",
  "platform_constraints",
  "data_compliance",
  "content_asset_production",
  "cost",
  "delivery",
  "risks_failure_modes",
  "alternatives",
] as const;

export const FEASIBILITY_RESEARCH_PASSES = [
  "BREADTH_SCAN",
  "PRIMARY_SOURCE_VERIFICATION",
  "CONTRADICTION_SEARCH",
  "ALTERNATIVE_SEARCH",
  "CRITICAL_UNKNOWN_DEEP_DIVE",
  "SYNTHESIS",
] as const;

export const FEASIBILITY_SOURCE_GRADES = [
  "A_PRIMARY",
  "B_AUTHORITATIVE_SECONDARY",
  "C_MARKET",
  "D_COMMUNITY",
  "E_INFERENCE",
] as const;

export const feasibilityResearchDimensionSchema = z.enum(
  FEASIBILITY_RESEARCH_DIMENSIONS,
);
export const feasibilityResearchPassSchema = z.enum(FEASIBILITY_RESEARCH_PASSES);
export const feasibilitySourceGradeSchema = z.enum(FEASIBILITY_SOURCE_GRADES);
export const feasibilityInterpretationBasisSchema = z.enum([
  "FACT",
  "GAP",
  "ASSUMPTION",
]);

const researchMaterialSchema = z.object({
  id: z.string().regex(/^SRC-\d{2,3}$/u),
  label: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(30_000),
}).strict();

export const feasibilityResearchInputSchema = z
  .object({
    schemaVersion: z.literal(FEASIBILITY_RESEARCH_INPUT_SCHEMA_VERSION),
    inputMode: z.enum([
      "portable_standalone",
      "project_bound_context",
      "requirement_analysis_pack",
    ]),
    projectId: z.string().trim().min(1).max(200).nullable(),
    title: z.string().trim().min(1).max(200),
    language: z.enum(["zh", "en"]),
    currentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    decisionQuestion: z.string().trim().min(1).max(2_000),
    materials: z.array(researchMaterialSchema).max(30),
    requirementAnalysisPack: requirementAnalysisPackSchema.nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.inputMode === "project_bound_context" && !input.projectId) {
      context.addIssue({ code: "custom", path: ["projectId"], message: "Project-bound research requires an authorized projectId" });
    }
    if (input.inputMode !== "project_bound_context" && input.projectId) {
      context.addIssue({ code: "custom", path: ["projectId"], message: "Portable research input must not imply Project binding" });
    }
    if (input.inputMode === "requirement_analysis_pack" && !input.requirementAnalysisPack) {
      context.addIssue({ code: "custom", path: ["requirementAnalysisPack"], message: "Requirement Analysis Pack mode requires a valid Pack" });
    }
    if (input.inputMode !== "requirement_analysis_pack" && input.requirementAnalysisPack) {
      context.addIssue({ code: "custom", path: ["requirementAnalysisPack"], message: "Unexpected Requirement Analysis Pack for this input mode" });
    }
    if (input.inputMode !== "requirement_analysis_pack" && input.materials.length === 0) {
      context.addIssue({ code: "custom", path: ["materials"], message: "Standalone research requires supplied materials" });
    }
    const ids = new Set(input.materials.map((item) => item.id));
    if (ids.size !== input.materials.length) {
      context.addIssue({ code: "custom", path: ["materials"], message: "Material IDs must be unique" });
    }
  });

const claimSchema = z.object({
  id: z.string().regex(/^CL-\d{2,3}$/u),
  claim: z.string().trim().min(1).max(1_000),
  dimension: feasibilityResearchDimensionSchema,
  criticality: z.enum(["CORE", "SUPPORTING"]),
  verificationNeed: z.string().trim().min(1).max(1_000),
}).strict();

const searchQuerySchema = z.object({
  id: z.string().regex(/^SQ-\d{2,3}$/u),
  purpose: z.enum(["BREADTH", "PRIMARY", "DEEP_DIVE"]),
  query: z.string().trim().min(1).max(1_000),
  dimension: feasibilityResearchDimensionSchema,
  claimIds: z.array(z.string().regex(/^CL-\d{2,3}$/u)).min(1),
}).strict();

const contradictionQuerySchema = z.object({
  id: z.string().regex(/^CQ-\d{2,3}$/u),
  query: z.string().trim().min(1).max(1_000),
  target: z.string().trim().min(1).max(500),
  dimension: feasibilityResearchDimensionSchema,
  claimIds: z.array(z.string().regex(/^CL-\d{2,3}$/u)).min(1),
}).strict();

const alternativeQuerySchema = z.object({
  id: z.string().regex(/^AQ-\d{2,3}$/u),
  query: z.string().trim().min(1).max(1_000),
  comparisonNeed: z.string().trim().min(1).max(500),
  dimension: feasibilityResearchDimensionSchema,
  claimIds: z.array(z.string().regex(/^CL-\d{2,3}$/u)).min(1),
}).strict();

export const feasibilityResearchPlanSchema = z
  .object({
    schemaVersion: z.literal(FEASIBILITY_RESEARCH_PLAN_SCHEMA_VERSION),
    skillId: z.literal(FEASIBILITY_RESEARCH_SKILL_ID),
    skillVersion: z.literal(FEASIBILITY_RESEARCH_SKILL_VERSION),
    title: z.string().trim().min(1).max(200),
    language: z.enum(["zh", "en"]),
    decisionQuestion: z.string().trim().min(1).max(2_000),
    researchDimensions: z.array(z.object({
      dimension: feasibilityResearchDimensionSchema,
      questions: z.array(z.string().trim().min(1).max(1_000)).min(1).max(20),
      priority: z.enum(["CORE", "SUPPORTING"]),
    }).strict()),
    claimsToVerify: z.array(claimSchema).min(1).max(200),
    searchQueries: z.array(searchQuerySchema).min(1).max(300),
    sourcePriority: z.array(z.object({
      grade: feasibilitySourceGradeSchema,
      order: z.number().int().min(1).max(5),
      useWhen: z.string().trim().min(1).max(1_000),
    }).strict()),
    contradictionQueries: z.array(contradictionQuerySchema).min(1).max(200),
    alternativeQueries: z.array(alternativeQuerySchema).min(1).max(200),
    stoppingCriteria: z.array(z.object({
      id: z.string().regex(/^SC-\d{2,3}$/u),
      kind: z.enum([
        "DIMENSION_COVERAGE",
        "PRIMARY_SOURCE",
        "CONTRADICTION",
        "ALTERNATIVE",
        "CRITICAL_UNKNOWN",
        "EVIDENCE_SUFFICIENCY",
      ]),
      description: z.string().trim().min(1).max(1_000),
      required: z.literal(true),
    }).strict()),
  })
  .strict()
  .superRefine((plan, context) => {
    const dimensions = new Set(plan.researchDimensions.map((item) => item.dimension));
    if (
      plan.researchDimensions.length !== FEASIBILITY_RESEARCH_DIMENSIONS.length ||
      FEASIBILITY_RESEARCH_DIMENSIONS.some((dimension) => !dimensions.has(dimension))
    ) {
      context.addIssue({ code: "custom", path: ["researchDimensions"], message: "Research Plan must cover every required dimension exactly once" });
    }
    if (
      plan.sourcePriority.length !== FEASIBILITY_SOURCE_GRADES.length ||
      plan.sourcePriority.some((item, index) =>
        item.grade !== FEASIBILITY_SOURCE_GRADES[index] || item.order !== index + 1)
    ) {
      context.addIssue({ code: "custom", path: ["sourcePriority"], message: "Source priority must be A Primary through E Inference in fixed order" });
    }
    const stopKinds = new Set(plan.stoppingCriteria.map((item) => item.kind));
    if (stopKinds.size !== 6 || plan.stoppingCriteria.length !== 6) {
      context.addIssue({ code: "custom", path: ["stoppingCriteria"], message: "Stopping Criteria must include all six required gate kinds exactly once" });
    }

    const claims = new Set(plan.claimsToVerify.map((item) => item.id));
    if (claims.size !== plan.claimsToVerify.length) {
      context.addIssue({ code: "custom", path: ["claimsToVerify"], message: "Claim IDs must be unique" });
    }
    const queryIds = [
      ...plan.searchQueries.map((item) => item.id),
      ...plan.contradictionQueries.map((item) => item.id),
      ...plan.alternativeQueries.map((item) => item.id),
    ];
    if (new Set(queryIds).size !== queryIds.length) {
      context.addIssue({ code: "custom", path: ["searchQueries"], message: "All Research Query IDs must be unique" });
    }
    for (const [groupName, queries] of [
      ["searchQueries", plan.searchQueries],
      ["contradictionQueries", plan.contradictionQueries],
      ["alternativeQueries", plan.alternativeQueries],
    ] as const) {
      for (const [index, query] of queries.entries()) {
        for (const claimId of query.claimIds) {
          if (!claims.has(claimId)) {
            context.addIssue({ code: "custom", path: [groupName, index, "claimIds"], message: `Unknown Claim ${claimId}` });
          }
        }
      }
    }
    const researchedClaims = new Set([
      ...plan.searchQueries.flatMap((item) => item.claimIds),
      ...plan.contradictionQueries.flatMap((item) => item.claimIds),
      ...plan.alternativeQueries.flatMap((item) => item.claimIds),
    ]);
    for (const [index, claim] of plan.claimsToVerify.entries()) {
      if (
        claim.criticality === "CORE" &&
        (!researchedClaims.has(claim.id) ||
          !plan.searchQueries.some((query) =>
            query.purpose === "PRIMARY" && query.claimIds.includes(claim.id)))
      ) {
        context.addIssue({ code: "custom", path: ["claimsToVerify", index], message: "Every CORE claim needs a planned primary-source query" });
      }
    }
  });

const evidenceSchema = z
  .object({
    id: z.string().regex(/^E-\d{2,3}$/u),
    title: z.string().trim().min(1).max(500),
    publisher: z.string().trim().min(1).max(300).nullable(),
    url: z.string().url().max(2_000).nullable(),
    publishedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
    accessedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    grade: feasibilitySourceGradeSchema,
    isPrimary: z.boolean(),
    dimensions: z.array(feasibilityResearchDimensionSchema).min(1),
    claimIds: z.array(z.string().regex(/^CL-\d{2,3}$/u)).min(1),
    stance: z.enum(["SUPPORTS", "CONTRADICTS", "MIXED", "CONTEXT"]),
    finding: z.string().trim().min(1).max(2_000),
    limitations: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.grade === "E_INFERENCE") {
      if (evidence.url || evidence.publisher || evidence.isPrimary) {
        context.addIssue({ code: "custom", path: ["grade"], message: "E Inference cannot masquerade as an external source" });
      }
    } else if (!evidence.url || !evidence.publisher) {
      context.addIssue({ code: "custom", path: ["url"], message: "Grades A-D require a publisher and URL" });
    }
    if (evidence.grade === "A_PRIMARY" && !evidence.isPrimary) {
      context.addIssue({ code: "custom", path: ["isPrimary"], message: "A Primary evidence must be a first-party source" });
    }
    if (evidence.grade !== "A_PRIMARY" && evidence.isPrimary) {
      context.addIssue({ code: "custom", path: ["isPrimary"], message: "Only A Primary evidence can be marked first-party" });
    }
  });

export const feasibilityResearchReportSchema = z
  .object({
    schemaVersion: z.literal(FEASIBILITY_RESEARCH_REPORT_SCHEMA_VERSION),
    skillId: z.literal(FEASIBILITY_RESEARCH_SKILL_ID),
    skillVersion: z.literal(FEASIBILITY_RESEARCH_SKILL_VERSION),
    title: z.string().trim().min(1).max(200),
    language: z.enum(["zh", "en"]),
    researchedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    inputMode: z.enum(["portable_standalone", "project_bound_context", "requirement_analysis_pack"]),
    researchPlan: feasibilityResearchPlanSchema,
    researchPasses: z.array(z.object({
      stage: feasibilityResearchPassSchema,
      status: z.literal("COMPLETE"),
      queryIds: z.array(z.string().regex(/^(?:SQ|CQ|AQ)-\d{2,3}$/u)),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)),
      notes: z.string().trim().min(1).max(2_000),
    }).strict()),
    executiveConclusion: z.object({
      conclusion: z.string().trim().min(1).max(3_000),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)).min(1),
    }).strict(),
    whatWeAreEvaluating: z.string().trim().min(1).max(3_000),
    requirementInterpretation: z.array(z.object({
      id: z.string().regex(/^RI-\d{2,3}$/u),
      basis: feasibilityInterpretationBasisSchema,
      statement: z.string().trim().min(1).max(2_000),
      sourceRef: z.string().trim().min(1).max(300).nullable(),
    }).strict()).min(1).max(200),
    optionsConsidered: z.array(z.object({
      id: z.string().regex(/^O-\d{2,3}$/u),
      name: z.string().trim().min(1).max(300),
      summary: z.string().trim().min(1).max(2_000),
      core: z.boolean(),
    }).strict()).min(2).max(50),
    feasibilityByDimension: z.array(z.object({
      dimension: feasibilityResearchDimensionSchema,
      status: z.enum(["FEASIBLE", "CONDITIONAL", "NOT_FEASIBLE", "UNKNOWN"]),
      assessment: z.string().trim().min(1).max(2_000),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)),
      unknownIds: z.array(z.string().regex(/^U-\d{2,3}$/u)),
    }).strict()),
    evidence: z.array(evidenceSchema).min(1).max(500),
    contradictionChecks: z.array(z.object({
      optionId: z.string().regex(/^O-\d{2,3}$/u),
      queryIds: z.array(z.string().regex(/^CQ-\d{2,3}$/u)).min(1),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)),
      finding: z.string().trim().min(1).max(2_000),
    }).strict()),
    constraints: z.array(z.object({
      id: z.string().regex(/^CST-\d{2,3}$/u),
      description: z.string().trim().min(1).max(1_000),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)),
      interpretationBasis: feasibilityInterpretationBasisSchema,
    }).strict()).max(100),
    risks: z.array(z.object({
      id: z.string().regex(/^RK-\d{2,3}$/u),
      description: z.string().trim().min(1).max(1_000),
      impact: z.enum(["HIGH", "MEDIUM", "LOW"]),
      likelihood: z.enum(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)),
    }).strict()).max(100),
    unknowns: z.array(z.object({
      id: z.string().regex(/^U-\d{2,3}$/u),
      description: z.string().trim().min(1).max(1_000),
      priority: z.enum(["P0", "P1", "P2"]),
      blocker: z.boolean(),
      resolution: z.string().trim().min(1).max(1_000),
    }).strict()).max(100),
    costEffortRange: z.object({
      currency: z.string().trim().min(1).max(20).nullable(),
      minimumCost: z.number().nonnegative().nullable(),
      maximumCost: z.number().nonnegative().nullable(),
      costBasis: z.enum(["EVIDENCE", "ASSUMPTION", "UNKNOWN"]),
      effortBand: z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
      effortBasis: z.enum(["EVIDENCE", "ASSUMPTION", "UNKNOWN"]),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)),
      caveats: z.array(z.string().trim().min(1).max(1_000)).min(1),
    }).strict(),
    recommendedApproach: z.object({
      optionId: z.string().regex(/^O-\d{2,3}$/u),
      rationale: z.string().trim().min(1).max(2_000),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)).min(1),
    }).strict(),
    alternativeApproach: z.object({
      optionId: z.string().regex(/^O-\d{2,3}$/u),
      rationale: z.string().trim().min(1).max(2_000),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)),
    }).strict(),
    decision: z.object({
      verdict: z.enum(["GO", "CONDITIONAL_GO", "NO_GO"]),
      rationale: z.string().trim().min(1).max(2_000),
      evidenceIds: z.array(z.string().regex(/^E-\d{2,3}$/u)).min(1),
      conditionUnknownIds: z.array(z.string().regex(/^U-\d{2,3}$/u)),
    }).strict(),
    stoppingCriteriaResults: z.array(z.object({
      criterionId: z.string().regex(/^SC-\d{2,3}$/u),
      met: z.literal(true),
      evidence: z.string().trim().min(1).max(1_000),
    }).strict()),
    whatMustBeConfirmedNext: z.array(z.string().regex(/^U-\d{2,3}$/u)),
  })
  .strict()
  .superRefine((report, context) => {
    const plan = report.researchPlan;
    const expectedPasses = FEASIBILITY_RESEARCH_PASSES;
    if (
      report.researchPasses.length !== expectedPasses.length ||
      report.researchPasses.some((item, index) => item.stage !== expectedPasses[index])
    ) {
      context.addIssue({ code: "custom", path: ["researchPasses"], message: "Research Protocol passes must be complete and in fixed order" });
    }

    const claims = new Set(plan.claimsToVerify.map((item) => item.id));
    const allQueryIds = new Set([
      ...plan.searchQueries.map((item) => item.id),
      ...plan.contradictionQueries.map((item) => item.id),
      ...plan.alternativeQueries.map((item) => item.id),
    ]);
    const evidence = new Map(report.evidence.map((item) => [item.id, item] as const));
    const options = new Map(report.optionsConsidered.map((item) => [item.id, item] as const));
    const unknowns = new Map(report.unknowns.map((item) => [item.id, item] as const));
    if (evidence.size !== report.evidence.length) {
      context.addIssue({ code: "custom", path: ["evidence"], message: "Evidence IDs must be unique" });
    }
    if (options.size !== report.optionsConsidered.length) {
      context.addIssue({ code: "custom", path: ["optionsConsidered"], message: "Option IDs must be unique" });
    }
    if (unknowns.size !== report.unknowns.length) {
      context.addIssue({ code: "custom", path: ["unknowns"], message: "Unknown IDs must be unique" });
    }

    const checkEvidenceRefs = (ids: string[], path: Array<string | number>) => {
      for (const id of ids) {
        if (!evidence.has(id)) context.addIssue({ code: "custom", path, message: `Unknown Evidence ${id}` });
      }
    };
    const checkUnknownRefs = (ids: string[], path: Array<string | number>) => {
      for (const id of ids) {
        if (!unknowns.has(id)) context.addIssue({ code: "custom", path, message: `Unknown unknown-item ${id}` });
      }
    };

    for (const [index, item] of report.evidence.entries()) {
      for (const claimId of item.claimIds) {
        if (!claims.has(claimId)) {
          context.addIssue({ code: "custom", path: ["evidence", index, "claimIds"], message: `Evidence references unknown Claim ${claimId}` });
        }
      }
    }
    for (const [index, pass] of report.researchPasses.entries()) {
      for (const id of pass.queryIds) {
        if (!allQueryIds.has(id)) context.addIssue({ code: "custom", path: ["researchPasses", index, "queryIds"], message: `Research pass references unknown Query ${id}` });
      }
      checkEvidenceRefs(pass.evidenceIds, ["researchPasses", index, "evidenceIds"]);
      if (pass.stage !== "SYNTHESIS" && pass.queryIds.length === 0) {
        context.addIssue({ code: "custom", path: ["researchPasses", index, "queryIds"], message: `${pass.stage} must execute at least one planned query` });
      }
      if (pass.stage === "SYNTHESIS" && pass.queryIds.length > 0) {
        context.addIssue({ code: "custom", path: ["researchPasses", index, "queryIds"], message: "SYNTHESIS must not disguise a new search query" });
      }
    }
    const contradictionPass = report.researchPasses[2];
    const alternativePass = report.researchPasses[3];
    if (!contradictionPass?.queryIds.some((id) => id.startsWith("CQ-"))) {
      context.addIssue({ code: "custom", path: ["researchPasses", 2], message: "Contradiction Search pass must execute a contradiction query" });
    }
    if (!alternativePass?.queryIds.some((id) => id.startsWith("AQ-"))) {
      context.addIssue({ code: "custom", path: ["researchPasses", 3], message: "Alternative Search pass must execute an alternative query" });
    }

    const assessedDimensions = new Set(report.feasibilityByDimension.map((item) => item.dimension));
    if (
      report.feasibilityByDimension.length !== FEASIBILITY_RESEARCH_DIMENSIONS.length ||
      FEASIBILITY_RESEARCH_DIMENSIONS.some((dimension) => !assessedDimensions.has(dimension))
    ) {
      context.addIssue({ code: "custom", path: ["feasibilityByDimension"], message: "Final report must assess every required dimension exactly once" });
    }
    for (const [index, assessment] of report.feasibilityByDimension.entries()) {
      checkEvidenceRefs(assessment.evidenceIds, ["feasibilityByDimension", index, "evidenceIds"]);
      checkUnknownRefs(assessment.unknownIds, ["feasibilityByDimension", index, "unknownIds"]);
      if (assessment.evidenceIds.length === 0 && assessment.unknownIds.length === 0) {
        context.addIssue({ code: "custom", path: ["feasibilityByDimension", index], message: "Dimension assessment needs evidence or an explicit unknown" });
      }
    }

    const contradictionByOption = new Map(report.contradictionChecks.map((item) => [item.optionId, item] as const));
    for (const option of report.optionsConsidered.filter((item) => item.core)) {
      if (!contradictionByOption.has(option.id)) {
        context.addIssue({ code: "custom", path: ["contradictionChecks"], message: `Core option ${option.id} needs a contradiction search` });
      }
    }
    for (const [index, check] of report.contradictionChecks.entries()) {
      if (!options.has(check.optionId)) context.addIssue({ code: "custom", path: ["contradictionChecks", index, "optionId"], message: "Contradiction check references unknown option" });
      for (const id of check.queryIds) {
        if (!plan.contradictionQueries.some((query) => query.id === id)) {
          context.addIssue({ code: "custom", path: ["contradictionChecks", index, "queryIds"], message: "Contradiction check must use planned contradiction queries" });
        }
        if (!contradictionPass?.queryIds.includes(id)) {
          context.addIssue({ code: "custom", path: ["contradictionChecks", index, "queryIds"], message: "Contradiction check query must appear in the executed Contradiction Search pass" });
        }
      }
      checkEvidenceRefs(check.evidenceIds, ["contradictionChecks", index, "evidenceIds"]);
    }

    for (const [collectionName, collection] of [
      ["constraints", report.constraints],
      ["risks", report.risks],
    ] as const) {
      for (const [index, item] of collection.entries()) {
        checkEvidenceRefs(item.evidenceIds, [collectionName, index, "evidenceIds"]);
      }
    }
    checkEvidenceRefs(report.executiveConclusion.evidenceIds, ["executiveConclusion", "evidenceIds"]);
    checkEvidenceRefs(report.costEffortRange.evidenceIds, ["costEffortRange", "evidenceIds"]);
    checkEvidenceRefs(report.recommendedApproach.evidenceIds, ["recommendedApproach", "evidenceIds"]);
    checkEvidenceRefs(report.alternativeApproach.evidenceIds, ["alternativeApproach", "evidenceIds"]);
    checkEvidenceRefs(report.decision.evidenceIds, ["decision", "evidenceIds"]);

    if (!options.has(report.recommendedApproach.optionId)) {
      context.addIssue({ code: "custom", path: ["recommendedApproach", "optionId"], message: "Recommended approach references unknown option" });
    }
    if (!options.has(report.alternativeApproach.optionId)) {
      context.addIssue({ code: "custom", path: ["alternativeApproach", "optionId"], message: "Alternative approach references unknown option" });
    }
    if (report.recommendedApproach.optionId === report.alternativeApproach.optionId) {
      context.addIssue({ code: "custom", path: ["alternativeApproach", "optionId"], message: "Alternative approach must differ from the recommendation" });
    }

    checkUnknownRefs(report.decision.conditionUnknownIds, ["decision", "conditionUnknownIds"]);
    checkUnknownRefs(report.whatMustBeConfirmedNext, ["whatMustBeConfirmedNext"]);
    const blockerIds = report.unknowns.filter((item) => item.blocker).map((item) => item.id);
    if (blockerIds.some((id) => !report.whatMustBeConfirmedNext.includes(id))) {
      context.addIssue({ code: "custom", path: ["whatMustBeConfirmedNext"], message: "Every blocker unknown must be confirmed next" });
    }
    if (report.decision.verdict === "GO" && blockerIds.length > 0) {
      context.addIssue({ code: "custom", path: ["decision", "verdict"], message: "GO is not allowed while blocker unknowns remain" });
    }
    if (report.decision.verdict === "CONDITIONAL_GO" && report.decision.conditionUnknownIds.length === 0) {
      context.addIssue({ code: "custom", path: ["decision", "conditionUnknownIds"], message: "CONDITIONAL_GO requires explicit conditions" });
    }
    if (
      report.decision.verdict === "GO" &&
      !report.decision.evidenceIds.some((id) => {
        const grade = evidence.get(id)?.grade;
        return grade === "A_PRIMARY" || grade === "B_AUTHORITATIVE_SECONDARY";
      })
    ) {
      context.addIssue({ code: "custom", path: ["decision", "evidenceIds"], message: "GO needs at least one A/B source" });
    }

    const [minimum, maximum] = [report.costEffortRange.minimumCost, report.costEffortRange.maximumCost];
    if ((minimum === null) !== (maximum === null) || (minimum !== null && maximum !== null && minimum > maximum)) {
      context.addIssue({ code: "custom", path: ["costEffortRange"], message: "Cost range must be complete and ordered" });
    }
    if (minimum !== null && report.costEffortRange.costBasis === "UNKNOWN") {
      context.addIssue({ code: "custom", path: ["costEffortRange", "costBasis"], message: "A numeric cost range cannot have UNKNOWN basis" });
    }
    if (report.costEffortRange.costBasis === "EVIDENCE" && report.costEffortRange.evidenceIds.length === 0) {
      context.addIssue({ code: "custom", path: ["costEffortRange", "evidenceIds"], message: "Evidence-based cost needs Evidence IDs" });
    }

    const plannedCriteria = new Set(plan.stoppingCriteria.map((item) => item.id));
    const resultCriteria = new Set(report.stoppingCriteriaResults.map((item) => item.criterionId));
    if (
      report.stoppingCriteriaResults.length !== plannedCriteria.size ||
      resultCriteria.size !== plannedCriteria.size ||
      [...plannedCriteria].some((id) => !resultCriteria.has(id))
    ) {
      context.addIssue({ code: "custom", path: ["stoppingCriteriaResults"], message: "All planned stopping criteria must be satisfied before conclusion" });
    }
  });

export type FeasibilityResearchDimension = z.infer<typeof feasibilityResearchDimensionSchema>;
export type FeasibilitySourceGrade = z.infer<typeof feasibilitySourceGradeSchema>;
export type FeasibilityResearchInput = z.infer<typeof feasibilityResearchInputSchema>;
export type FeasibilityResearchPlan = z.infer<typeof feasibilityResearchPlanSchema>;
export type FeasibilityResearchReport = z.infer<typeof feasibilityResearchReportSchema>;
