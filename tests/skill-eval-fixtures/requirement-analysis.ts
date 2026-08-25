import {
  REQUIREMENT_ANALYSIS_DOMAINS,
  requirementAnalysisPackSchema,
  type RequirementAnalysisBasis,
  type RequirementAnalysisDomain,
  type RequirementAnalysisPack,
  type RequirementStatement,
} from "@/lib/requirement-analyst";

type CoverageMode = "COMPLETE" | "PARTIAL" | "MISSING" | "ASSUMED" | "NOT_APPLICABLE";

export function makeRequirementAnalysisPack(input: {
  title: string;
  coverage?: Partial<Record<RequirementAnalysisDomain, CoverageMode>>;
  factText?: Partial<Record<RequirementAnalysisDomain, string>>;
  gapText?: Partial<Record<RequirementAnalysisDomain, string>>;
  assumptionText?: Partial<Record<RequirementAnalysisDomain, string>>;
}): RequirementAnalysisPack {
  const statements: RequirementStatement[] = [];
  const assessmentIds = new Map<RequirementAnalysisDomain, string[]>();
  let factIndex = 1;
  let gapIndex = 1;
  let assumptionIndex = 1;

  const addStatement = (
    domain: RequirementAnalysisDomain,
    basis: RequirementAnalysisBasis,
    text: string,
  ) => {
    const index = basis === "FACT"
      ? factIndex++
      : basis === "GAP"
        ? gapIndex++
        : assumptionIndex++;
    const prefix = basis === "FACT" ? "F" : basis === "GAP" ? "G" : "A";
    const id = `${prefix}-${String(index).padStart(2, "0")}`;
    statements.push({
      id,
      basis,
      domain,
      statement: text,
      sourceEvidence: basis === "FACT" ? text : null,
      sourceIds: basis === "FACT" ? ["SRC-01"] : [],
      reason: basis === "FACT"
        ? "Explicitly supplied by the synthetic fixture"
        : basis === "GAP"
          ? "Required domain information is absent or ambiguous"
          : "Bounded hypothesis for review only",
    });
    const ids = assessmentIds.get(domain) ?? [];
    ids.push(id);
    assessmentIds.set(domain, ids);
    return id;
  };

  for (const domain of REQUIREMENT_ANALYSIS_DOMAINS) {
    const coverage = input.coverage?.[domain] ?? "MISSING";
    if (coverage === "COMPLETE" || coverage === "PARTIAL" || coverage === "NOT_APPLICABLE") {
      addStatement(
        domain,
        "FACT",
        input.factText?.[domain] ??
          (coverage === "NOT_APPLICABLE"
            ? `Synthetic input explicitly excludes ${domain}`
            : `Synthetic input confirms ${domain}`),
      );
    }
    if (coverage === "MISSING" || coverage === "PARTIAL") {
      addStatement(
        domain,
        "GAP",
        input.gapText?.[domain] ?? `The input does not fully define ${domain}`,
      );
    }
    if (coverage === "ASSUMED") {
      addStatement(
        domain,
        "ASSUMPTION",
        input.assumptionText?.[domain] ?? `Assume a provisional ${domain} for discussion`,
      );
    }
  }

  const statementById = new Map(statements.map((item) => [item.id, item] as const));
  const primaryForDomain = (domain: RequirementAnalysisDomain) => {
    const candidates = (assessmentIds.get(domain) ?? []).map((id) => statementById.get(id)!);
    return candidates.find((item) => item.basis === "GAP") ??
      candidates.find((item) => item.basis === "ASSUMPTION") ??
      candidates[0];
  };
  const gaps = statements.filter((item) => item.basis === "GAP");
  const priorityForDomain = (domain: RequirementAnalysisDomain) => {
    const index = REQUIREMENT_ANALYSIS_DOMAINS.indexOf(domain);
    return index < 8 ? "P0" as const : index < 14 ? "P1" as const : "P2" as const;
  };
  const journeyStatement = primaryForDomain("user_journey");
  const scopeStatement = primaryForDomain("functional_scope");
  const deliverableStatement = primaryForDomain("deliverable");
  const dependencyStatement = primaryForDomain("project_dependency");
  const dataStatement = primaryForDomain("data");
  const scopeDisposition = input.coverage?.functional_scope === "NOT_APPLICABLE"
    ? "OUT_OF_SCOPE" as const
    : scopeStatement.basis === "FACT"
      ? "IN_SCOPE" as const
      : "UNRESOLVED" as const;
  const nextStatement = gaps[0] ?? statements.find((item) => item.basis === "ASSUMPTION") ?? statements[0];

  return requirementAnalysisPackSchema.parse({
    schemaVersion: "projectai-requirement-analysis-pack-v2",
    skillId: "project-requirement-analyst",
    skillVersion: "0.2.1",
    title: input.title,
    language: "zh",
    sourceSummary: "Synthetic fixture used only for deterministic contract evaluation.",
    sourceMaterialIds: ["SRC-01"],
    statements,
    domainAssessments: REQUIREMENT_ANALYSIS_DOMAINS.map((domain) => ({
      domain,
      coverage: input.coverage?.[domain] ?? "MISSING",
      statementIds: assessmentIds.get(domain),
      rationale: `Synthetic ${input.coverage?.[domain] ?? "MISSING"} assessment for ${domain}`,
    })),
    requirementSummary: {
      summary: "Synthetic Requirement Analysis Pack for deterministic validation.",
      statementIds: statements.slice(0, 6).map((item) => item.id),
    },
    businessConcepts: [{
      id: "BC-01",
      order: 1,
      name: deliverableStatement.statement,
      definition: "从当前交付物材料抽象的核心业务概念。",
      keyAttributes: ["定义边界待核验"],
      relationships: ["与用户、场景和功能范围相关"],
      notes: deliverableStatement.basis === "FACT"
        ? "概念名称有材料依据；详细属性仍需继续澄清。"
        : "材料不足，仅作为待确认的概念占位。",
      basis: deliverableStatement.basis,
      statementIds: [deliverableStatement.id],
    }],
    userJourneyDraft: [{
      id: "J-01",
      order: 1,
      actor: journeyStatement.basis === "FACT" ? "Confirmed user" : "User to confirm",
      action: "Complete the primary project interaction",
      outcome: "Reach the intended outcome",
      notes: journeyStatement.basis === "FACT"
        ? "Flow step is grounded in supplied material."
        : "Core-flow consideration only; not confirmed scope.",
      basis: journeyStatement.basis,
      statementIds: [journeyStatement.id],
    }],
    functionalScopeDraft: [{
      id: "S-01",
      order: 1,
      surface: "待确认端",
      module: "Primary project capability",
      description: scopeStatement.statement,
      disposition: scopeDisposition,
      notes: scopeStatement.basis === "FACT"
        ? "Confirmed by the synthetic functional-scope evidence."
        : "Core-link consideration only; not confirmed scope.",
      basis: scopeStatement.basis,
      statementIds: [scopeStatement.id],
    }],
    informationArchitecture: [{
      id: "IA-01",
      parentId: null,
      order: 1,
      surface: "待确认端",
      label: "主要信息入口",
      nodeType: "SURFACE",
      description: "承载当前主要交付物的信息入口。",
      notes: scopeStatement.basis === "FACT"
        ? "节点有功能范围依据。"
        : "候选节点，需确认后才能纳入正式信息架构。",
      basis: scopeStatement.basis,
      statementIds: [scopeStatement.id],
    }],
    requirementMatrix: REQUIREMENT_ANALYSIS_DOMAINS.map((domain, index) => {
      const statement = primaryForDomain(domain);
      const status = input.coverage?.[domain] === "NOT_APPLICABLE"
        ? "OUT_OF_SCOPE" as const
        : statement.basis === "GAP"
          ? "MISSING" as const
          : statement.basis === "ASSUMPTION"
            ? "ASSUMED" as const
            : "CONFIRMED" as const;
      return {
        id: `R-${String(index + 1).padStart(2, "0")}`,
        domain,
        requirement: statement.statement,
        status,
        priority: priorityForDomain(domain),
        acceptanceSignal: statement.basis === "FACT" ? "Confirm against supplied evidence" : null,
        basis: statement.basis,
        statementIds: [statement.id],
      };
    }),
    missingInformation: gaps.map((item, index) => ({
      id: `MI-${String(index + 1).padStart(2, "0")}`,
      domain: item.domain,
      description: item.statement,
      priority: priorityForDomain(item.domain),
      impact: `May change the ${item.domain} decision`,
      gapStatementIds: [item.id],
    })),
    criticalQuestions: gaps.map((item, index) => ({
      id: `Q-${String(index + 1).padStart(2, "0")}`,
      priority: priorityForDomain(item.domain),
      question: `What is the confirmed ${item.domain} requirement?`,
      why: `It resolves ${item.id} without invention`,
      answerOwner: null,
      resolvesGapStatementIds: [item.id],
    })),
    dependencies: [{
      id: "D-01",
      description: dependencyStatement.statement,
      impact: "May block downstream scope or delivery planning",
      basis: dependencyStatement.basis,
      statementIds: [dependencyStatement.id],
    }],
    risksUnknowns: [{
      id: "RU-01",
      kind: dataStatement.basis === "GAP" ? "UNKNOWN" : "RISK",
      priority: priorityForDomain("data"),
      description: dataStatement.statement,
      impact: "May change data handling and acceptance",
      basis: dataStatement.basis,
      statementIds: [dataStatement.id],
    }],
    initialScopeBoundary: {
      inScopeIds: scopeDisposition === "IN_SCOPE" ? ["S-01"] : [],
      outOfScopeIds: scopeDisposition === "OUT_OF_SCOPE" ? ["S-01"] : [],
      deferredIds: [],
      unresolvedIds: scopeDisposition === "UNRESOLVED" ? ["S-01"] : [],
    },
    suggestedNextStep: {
      action: nextStatement.basis === "FACT"
        ? "Review and approve the confirmed requirement analysis"
        : "Resolve the highest-priority open requirement before commitment",
      requiresUserConfirmation: nextStatement.basis !== "FACT",
      basis: nextStatement.basis,
      statementIds: [nextStatement.id],
    },
    warnings: ["Synthetic contract fixture; not a real project analysis."],
  });
}
