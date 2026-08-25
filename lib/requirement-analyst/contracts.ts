import { z } from "zod";

export const REQUIREMENT_ANALYST_SKILL_ID = "project-requirement-analyst";
export const REQUIREMENT_ANALYST_SKILL_VERSION = "0.2.1";
export const REQUIREMENT_ANALYSIS_INPUT_SCHEMA_VERSION =
  "projectai-requirement-analysis-input-v1";
export const REQUIREMENT_ANALYSIS_PACK_SCHEMA_VERSION =
  "projectai-requirement-analysis-pack-v2";

export const REQUIREMENT_ANALYSIS_DOMAINS = [
  "business_goal",
  "user",
  "scenario",
  "deliverable",
  "success_metric",
  "channel",
  "deadline",
  "constraint",
  "user_journey",
  "functional_scope",
  "identity_permission",
  "data",
  "ai_behavior",
  "third_party_integration",
  "content_asset",
  "operations_rules",
  "test_launch",
  "project_dependency",
] as const;

export const requirementAnalysisDomainSchema = z.enum(
  REQUIREMENT_ANALYSIS_DOMAINS,
);
export const requirementAnalysisBasisSchema = z.enum([
  "FACT",
  "GAP",
  "ASSUMPTION",
]);
export const requirementAnalysisPrioritySchema = z.enum(["P0", "P1", "P2"]);

export const requirementAnalysisInputSchema = z
  .object({
    schemaVersion: z.literal(REQUIREMENT_ANALYSIS_INPUT_SCHEMA_VERSION),
    inputMode: z.enum(["portable_user_supplied", "project_bound_context"]),
    projectId: z.string().trim().min(1).max(200).nullable(),
    title: z.string().trim().min(1).max(200),
    language: z.enum(["zh", "en"]),
    materials: z
      .array(z.object({
        id: z.string().regex(/^SRC-\d{2,3}$/u),
        label: z.string().trim().min(1).max(200),
        content: z.string().trim().min(1).max(30_000),
      }).strict())
      .min(1)
      .max(30),
    requestedOutcome: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.inputMode === "project_bound_context" && !input.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Project-bound context requires an authorized projectId",
      });
    }
    if (input.inputMode === "portable_user_supplied" && input.projectId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Portable user-supplied input must not imply Project binding",
      });
    }
    const sourceIds = new Set<string>();
    for (const [index, material] of input.materials.entries()) {
      if (sourceIds.has(material.id)) {
        context.addIssue({
          code: "custom",
          path: ["materials", index, "id"],
          message: "Material IDs must be unique",
        });
      }
      sourceIds.add(material.id);
    }
  });

export const requirementStatementSchema = z
  .object({
    id: z.string().regex(/^(?:F|G|A)-\d{2,3}$/u),
    basis: requirementAnalysisBasisSchema,
    domain: requirementAnalysisDomainSchema,
    statement: z.string().trim().min(1).max(2_000),
    sourceEvidence: z.string().trim().min(1).max(2_000).nullable(),
    sourceIds: z.array(z.string().regex(/^SRC-\d{2,3}$/u)).max(30),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((statement, context) => {
    const expectedPrefix = statement.basis === "FACT"
      ? "F-"
      : statement.basis === "GAP"
        ? "G-"
        : "A-";
    if (!statement.id.startsWith(expectedPrefix)) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: `Statement ID must use the ${expectedPrefix} prefix`,
      });
    }
    if (statement.basis === "FACT" && !statement.sourceEvidence) {
      context.addIssue({
        code: "custom",
        path: ["sourceEvidence"],
        message: "FACT requires explicit supplied evidence",
      });
    }
    if (statement.basis === "FACT" && statement.sourceIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceIds"],
        message: "FACT requires at least one supplied source ID",
      });
    }
    if (statement.basis === "ASSUMPTION" && statement.sourceEvidence) {
      context.addIssue({
        code: "custom",
        path: ["sourceEvidence"],
        message: "ASSUMPTION must not be presented as source evidence",
      });
    }
  });

export const requirementDomainAssessmentSchema = z.object({
  domain: requirementAnalysisDomainSchema,
  coverage: z.enum([
    "COMPLETE",
    "PARTIAL",
    "MISSING",
    "ASSUMED",
    "NOT_APPLICABLE",
  ]),
  statementIds: z.array(z.string().regex(/^(?:F|G|A)-\d{2,3}$/u)).min(1),
  rationale: z.string().trim().min(1).max(1_000),
}).strict();

const basedReferenceSchema = z.object({
  basis: requirementAnalysisBasisSchema,
  statementIds: z.array(z.string().regex(/^(?:F|G|A)-\d{2,3}$/u)).min(1),
}).strict();

export const requirementBusinessConceptSchema = basedReferenceSchema.extend({
  id: z.string().regex(/^BC-\d{2,3}$/u),
  order: z.number().int().positive(),
  name: z.string().trim().min(1).max(300),
  definition: z.string().trim().min(1).max(1_000),
  keyAttributes: z.array(z.string().trim().min(1).max(300)).max(30),
  relationships: z.array(z.string().trim().min(1).max(500)).max(30),
  notes: z.string().trim().min(1).max(1_000),
}).strict();

export const requirementJourneyStepSchema = basedReferenceSchema.extend({
  id: z.string().regex(/^J-\d{2,3}$/u),
  order: z.number().int().positive(),
  actor: z.string().trim().min(1).max(200),
  action: z.string().trim().min(1).max(1_000),
  outcome: z.string().trim().min(1).max(1_000),
  notes: z.string().trim().min(1).max(1_000),
}).strict();

export const requirementScopeItemSchema = basedReferenceSchema.extend({
  id: z.string().regex(/^S-\d{2,3}$/u),
  order: z.number().int().positive(),
  surface: z.string().trim().min(1).max(200),
  module: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(1_000),
  disposition: z.enum(["IN_SCOPE", "OUT_OF_SCOPE", "DEFERRED", "UNRESOLVED"]),
  notes: z.string().trim().min(1).max(1_000),
}).strict();

export const requirementInformationArchitectureNodeSchema = basedReferenceSchema.extend({
  id: z.string().regex(/^IA-\d{2,3}$/u),
  parentId: z.string().regex(/^IA-\d{2,3}$/u).nullable(),
  order: z.number().int().positive(),
  surface: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(300),
  nodeType: z.enum(["SURFACE", "SECTION", "PAGE", "FEATURE", "CONTENT"]),
  description: z.string().trim().min(1).max(1_000),
  notes: z.string().trim().min(1).max(1_000),
}).strict();

export const requirementMatrixItemSchema = basedReferenceSchema.extend({
  id: z.string().regex(/^R-\d{2,3}$/u),
  domain: requirementAnalysisDomainSchema,
  requirement: z.string().trim().min(1).max(1_000),
  status: z.enum(["CONFIRMED", "MISSING", "ASSUMED", "OUT_OF_SCOPE"]),
  priority: requirementAnalysisPrioritySchema,
  acceptanceSignal: z.string().trim().min(1).max(1_000).nullable(),
}).strict();

export const requirementMissingInformationSchema = z.object({
  id: z.string().regex(/^MI-\d{2,3}$/u),
  domain: requirementAnalysisDomainSchema,
  description: z.string().trim().min(1).max(1_000),
  priority: requirementAnalysisPrioritySchema,
  impact: z.string().trim().min(1).max(1_000),
  gapStatementIds: z.array(z.string().regex(/^G-\d{2,3}$/u)).min(1),
}).strict();

export const requirementCriticalQuestionSchema = z.object({
  id: z.string().regex(/^Q-\d{2,3}$/u),
  priority: requirementAnalysisPrioritySchema,
  question: z.string().trim().min(1).max(1_000),
  why: z.string().trim().min(1).max(1_000),
  answerOwner: z.string().trim().min(1).max(200).nullable(),
  resolvesGapStatementIds: z.array(z.string().regex(/^G-\d{2,3}$/u)).min(1),
}).strict();

export const requirementDependencySchema = basedReferenceSchema.extend({
  id: z.string().regex(/^D-\d{2,3}$/u),
  description: z.string().trim().min(1).max(1_000),
  impact: z.string().trim().min(1).max(1_000),
}).strict();

export const requirementRiskUnknownSchema = basedReferenceSchema.extend({
  id: z.string().regex(/^RU-\d{2,3}$/u),
  kind: z.enum(["RISK", "UNKNOWN"]),
  priority: requirementAnalysisPrioritySchema,
  description: z.string().trim().min(1).max(1_000),
  impact: z.string().trim().min(1).max(1_000),
}).strict();

export const requirementAnalysisPackSchema = z
  .object({
    schemaVersion: z.literal(REQUIREMENT_ANALYSIS_PACK_SCHEMA_VERSION),
    skillId: z.literal(REQUIREMENT_ANALYST_SKILL_ID),
    skillVersion: z.literal(REQUIREMENT_ANALYST_SKILL_VERSION),
    title: z.string().trim().min(1).max(200),
    language: z.enum(["zh", "en"]),
    sourceSummary: z.string().trim().min(1).max(2_000),
    sourceMaterialIds: z.array(z.string().regex(/^SRC-\d{2,3}$/u)).min(1).max(30),
    statements: z.array(requirementStatementSchema).min(1).max(300),
    domainAssessments: z.array(requirementDomainAssessmentSchema),
    requirementSummary: z.object({
      summary: z.string().trim().min(1).max(3_000),
      statementIds: z.array(z.string().regex(/^(?:F|G|A)-\d{2,3}$/u)).min(1),
    }).strict(),
    businessConcepts: z.array(requirementBusinessConceptSchema).max(100),
    userJourneyDraft: z.array(requirementJourneyStepSchema).max(100),
    functionalScopeDraft: z.array(requirementScopeItemSchema).max(200),
    informationArchitecture: z.array(requirementInformationArchitectureNodeSchema).max(300),
    requirementMatrix: z.array(requirementMatrixItemSchema).min(1).max(300),
    missingInformation: z.array(requirementMissingInformationSchema).max(200),
    criticalQuestions: z.array(requirementCriticalQuestionSchema).max(100),
    dependencies: z.array(requirementDependencySchema).max(100),
    risksUnknowns: z.array(requirementRiskUnknownSchema).max(100),
    initialScopeBoundary: z.object({
      inScopeIds: z.array(z.string().regex(/^S-\d{2,3}$/u)),
      outOfScopeIds: z.array(z.string().regex(/^S-\d{2,3}$/u)),
      deferredIds: z.array(z.string().regex(/^S-\d{2,3}$/u)),
      unresolvedIds: z.array(z.string().regex(/^S-\d{2,3}$/u)),
    }).strict(),
    suggestedNextStep: basedReferenceSchema.extend({
      action: z.string().trim().min(1).max(1_000),
      requiresUserConfirmation: z.boolean(),
    }).strict(),
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(100),
  })
  .strict()
  .superRefine((pack, context) => {
    const statements = new Map(pack.statements.map((item) => [item.id, item] as const));
    if (statements.size !== pack.statements.length) {
      context.addIssue({ code: "custom", path: ["statements"], message: "Statement IDs must be unique" });
    }

    const reference = (
      ids: string[],
      path: Array<string | number>,
      expectedBasis?: z.infer<typeof requirementAnalysisBasisSchema>,
    ) => {
      for (const id of ids) {
        const statement = statements.get(id);
        if (!statement) {
          context.addIssue({ code: "custom", path, message: `Unknown statement reference ${id}` });
        }
      }
      if (expectedBasis && !ids.some((id) => statements.get(id)?.basis === expectedBasis)) {
        context.addIssue({
          code: "custom",
          path,
          message: `Item with basis ${expectedBasis} must reference a matching statement`,
        });
      }
    };

    const sourceIds = new Set(pack.sourceMaterialIds);
    if (sourceIds.size !== pack.sourceMaterialIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceMaterialIds"],
        message: "Source material IDs must be unique",
      });
    }
    for (const [index, statement] of pack.statements.entries()) {
      if (statement.sourceIds.some((id) => !sourceIds.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["statements", index, "sourceIds"],
          message: "Statement references an unknown supplied source",
        });
      }
    }

    const domains = new Set(pack.domainAssessments.map((item) => item.domain));
    if (
      pack.domainAssessments.length !== REQUIREMENT_ANALYSIS_DOMAINS.length ||
      REQUIREMENT_ANALYSIS_DOMAINS.some((domain) => !domains.has(domain))
    ) {
      context.addIssue({
        code: "custom",
        path: ["domainAssessments"],
        message: "Controlled framework must assess every required domain exactly once",
      });
    }
    for (const [index, assessment] of pack.domainAssessments.entries()) {
      reference(assessment.statementIds, ["domainAssessments", index, "statementIds"]);
      const bases = new Set(assessment.statementIds.map((id) => statements.get(id)?.basis));
      const valid = assessment.coverage === "COMPLETE"
        ? bases.has("FACT")
        : assessment.coverage === "PARTIAL"
          ? bases.has("FACT") && bases.has("GAP")
          : assessment.coverage === "MISSING"
            ? bases.has("GAP")
            : assessment.coverage === "ASSUMED"
              ? bases.has("ASSUMPTION")
              : bases.has("FACT");
      if (!valid) {
        context.addIssue({
          code: "custom",
          path: ["domainAssessments", index, "coverage"],
          message: `Coverage ${assessment.coverage} is inconsistent with its statement evidence`,
        });
      }
    }

    reference(pack.requirementSummary.statementIds, ["requirementSummary", "statementIds"]);
    const basedCollections = [
      ["businessConcepts", pack.businessConcepts],
      ["userJourneyDraft", pack.userJourneyDraft],
      ["functionalScopeDraft", pack.functionalScopeDraft],
      ["informationArchitecture", pack.informationArchitecture],
      ["requirementMatrix", pack.requirementMatrix],
      ["dependencies", pack.dependencies],
      ["risksUnknowns", pack.risksUnknowns],
    ] as const;
    for (const [collectionName, collection] of basedCollections) {
      for (const [index, item] of collection.entries()) {
        reference(item.statementIds, [collectionName, index, "statementIds"], item.basis);
      }
    }
    reference(
      pack.suggestedNextStep.statementIds,
      ["suggestedNextStep", "statementIds"],
      pack.suggestedNextStep.basis,
    );
    if (pack.suggestedNextStep.basis !== "FACT" && !pack.suggestedNextStep.requiresUserConfirmation) {
      context.addIssue({
        code: "custom",
        path: ["suggestedNextStep", "requiresUserConfirmation"],
        message: "Gap- or assumption-based next steps require user confirmation",
      });
    }

    for (const [index, item] of pack.requirementMatrix.entries()) {
      const validStatus = item.basis === "GAP"
        ? item.status === "MISSING"
        : item.basis === "ASSUMPTION"
          ? item.status === "ASSUMED"
          : item.status === "CONFIRMED" || item.status === "OUT_OF_SCOPE";
      if (!validStatus) {
        context.addIssue({
          code: "custom",
          path: ["requirementMatrix", index, "status"],
          message: `${item.basis} matrix row cannot use status ${item.status}`,
        });
      }
    }

    for (const [index, item] of pack.functionalScopeDraft.entries()) {
      if (
        item.basis !== "FACT" &&
        item.disposition !== "UNRESOLVED"
      ) {
        context.addIssue({
          code: "custom",
          path: ["functionalScopeDraft", index, "disposition"],
          message: "Gap- or assumption-based scope must remain UNRESOLVED",
        });
      }
    }

    const architectureById = new Map(
      pack.informationArchitecture.map((item) => [item.id, item] as const),
    );
    const scopeStatementIds = new Set(
      pack.functionalScopeDraft.flatMap((item) => item.statementIds),
    );
    if (architectureById.size !== pack.informationArchitecture.length) {
      context.addIssue({
        code: "custom",
        path: ["informationArchitecture"],
        message: "Information Architecture node IDs must be unique",
      });
    }
    for (const [index, item] of pack.informationArchitecture.entries()) {
      if (item.parentId && !architectureById.has(item.parentId)) {
        context.addIssue({
          code: "custom",
          path: ["informationArchitecture", index, "parentId"],
          message: `Unknown Information Architecture parent ${item.parentId}`,
        });
      }
      if (item.parentId === item.id) {
        context.addIssue({
          code: "custom",
          path: ["informationArchitecture", index, "parentId"],
          message: "Information Architecture node cannot be its own parent",
        });
      }
      if (!item.statementIds.some((id) => scopeStatementIds.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["informationArchitecture", index, "statementIds"],
          message: "Information Architecture must derive from Functional Scope evidence",
        });
      }
      const ancestors = new Set<string>([item.id]);
      let parentId = item.parentId;
      while (parentId) {
        if (ancestors.has(parentId)) {
          context.addIssue({
            code: "custom",
            path: ["informationArchitecture", index, "parentId"],
            message: "Information Architecture must not contain a cycle",
          });
          break;
        }
        ancestors.add(parentId);
        parentId = architectureById.get(parentId)?.parentId ?? null;
      }
    }

    const gapPriority = new Map<string, z.infer<typeof requirementAnalysisPrioritySchema>>();
    for (const [index, item] of pack.missingInformation.entries()) {
      reference(item.gapStatementIds, ["missingInformation", index, "gapStatementIds"], "GAP");
      for (const id of item.gapStatementIds) {
        const current = gapPriority.get(id);
        const ranks = { P0: 0, P1: 1, P2: 2 } as const;
        if (!current || ranks[item.priority] < ranks[current]) gapPriority.set(id, item.priority);
      }
    }
    const questionPriority = new Map<string, z.infer<typeof requirementAnalysisPrioritySchema>>();
    for (const [index, question] of pack.criticalQuestions.entries()) {
      reference(
        question.resolvesGapStatementIds,
        ["criticalQuestions", index, "resolvesGapStatementIds"],
        "GAP",
      );
      for (const id of question.resolvesGapStatementIds) {
        const current = questionPriority.get(id);
        const ranks = { P0: 0, P1: 1, P2: 2 } as const;
        if (!current || ranks[question.priority] < ranks[current]) {
          questionPriority.set(id, question.priority);
        }
      }
    }
    const ranks = { P0: 0, P1: 1, P2: 2 } as const;
    for (const statement of pack.statements.filter((item) => item.basis === "GAP")) {
      const missingPriority = gapPriority.get(statement.id);
      if (!missingPriority) {
        context.addIssue({
          code: "custom",
          path: ["missingInformation"],
          message: `Gap ${statement.id} must appear in Missing Information`,
        });
        continue;
      }
      const askedPriority = questionPriority.get(statement.id);
      if (!askedPriority || ranks[askedPriority] > ranks[missingPriority]) {
        context.addIssue({
          code: "custom",
          path: ["criticalQuestions"],
          message: `Gap ${statement.id} needs an equal- or higher-priority Critical Question`,
        });
      }
    }

    const scopeById = new Map(pack.functionalScopeDraft.map((item) => [item.id, item] as const));
    const boundaryGroups = [
      ["inScopeIds", "IN_SCOPE"],
      ["outOfScopeIds", "OUT_OF_SCOPE"],
      ["deferredIds", "DEFERRED"],
      ["unresolvedIds", "UNRESOLVED"],
    ] as const;
    const boundaryIds: string[] = [];
    for (const [field, disposition] of boundaryGroups) {
      for (const id of pack.initialScopeBoundary[field]) {
        boundaryIds.push(id);
        if (scopeById.get(id)?.disposition !== disposition) {
          context.addIssue({
            code: "custom",
            path: ["initialScopeBoundary", field],
            message: `${id} must reference a ${disposition} scope item`,
          });
        }
      }
    }
    if (
      new Set(boundaryIds).size !== boundaryIds.length ||
      boundaryIds.length !== pack.functionalScopeDraft.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["initialScopeBoundary"],
        message: "Every scope item must appear exactly once in the matching boundary group",
      });
    }
  });

export type RequirementAnalysisDomain = z.infer<typeof requirementAnalysisDomainSchema>;
export type RequirementAnalysisBasis = z.infer<typeof requirementAnalysisBasisSchema>;
export type RequirementAnalysisPriority = z.infer<typeof requirementAnalysisPrioritySchema>;
export type RequirementAnalysisInput = z.infer<typeof requirementAnalysisInputSchema>;
export type RequirementStatement = z.infer<typeof requirementStatementSchema>;
export type RequirementDomainAssessment = z.infer<typeof requirementDomainAssessmentSchema>;
export type RequirementBusinessConcept = z.infer<typeof requirementBusinessConceptSchema>;
export type RequirementInformationArchitectureNode = z.infer<
  typeof requirementInformationArchitectureNodeSchema
>;
export type RequirementAnalysisPack = z.infer<typeof requirementAnalysisPackSchema>;
