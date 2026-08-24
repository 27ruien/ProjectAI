import {
  FEASIBILITY_RESEARCH_DIMENSIONS,
  FEASIBILITY_RESEARCH_PASSES,
  FEASIBILITY_SOURCE_GRADES,
  feasibilityResearchPlanSchema,
  feasibilityResearchReportSchema,
  type FeasibilityResearchPlan,
  type FeasibilityResearchReport,
} from "@/lib/feasibility-research";

export function makeFeasibilityResearchPlan(): FeasibilityResearchPlan {
  const claims = FEASIBILITY_RESEARCH_DIMENSIONS.map((dimension, index) => ({
    id: `CL-${String(index + 1).padStart(2, "0")}`,
    claim: `Synthetic claim for ${dimension}`,
    dimension,
    criticality: index < 2 ? "CORE" as const : "SUPPORTING" as const,
    verificationNeed: `Verify the ${dimension} feasibility with appropriate evidence`,
  }));
  return feasibilityResearchPlanSchema.parse({
    schemaVersion: "projectai-feasibility-research-plan-v1",
    skillId: "project-feasibility-research",
    skillVersion: "0.1.0",
    title: "Synthetic Feasibility Research Plan",
    language: "zh",
    decisionQuestion: "Should the synthetic project choose Option A under the stated constraints?",
    researchDimensions: FEASIBILITY_RESEARCH_DIMENSIONS.map((dimension, index) => ({
      dimension,
      questions: [`What evidence determines ${dimension}?`],
      priority: index < 2 ? "CORE" : "SUPPORTING",
    })),
    claimsToVerify: claims,
    searchQueries: [
      ...claims.map((claim, index) => ({
        id: `SQ-${String(index + 1).padStart(2, "0")}`,
        purpose: "BREADTH" as const,
        query: `synthetic breadth query ${claim.dimension}`,
        dimension: claim.dimension,
        claimIds: [claim.id],
      })),
      ...claims.map((claim, index) => ({
        id: `SQ-${String(index + 11).padStart(2, "0")}`,
        purpose: "PRIMARY" as const,
        query: `synthetic primary source query ${claim.dimension}`,
        dimension: claim.dimension,
        claimIds: [claim.id],
      })),
      ...claims.map((claim, index) => ({
        id: `SQ-${String(index + 21).padStart(2, "0")}`,
        purpose: "DEEP_DIVE" as const,
        query: `synthetic critical unknown query ${claim.dimension}`,
        dimension: claim.dimension,
        claimIds: [claim.id],
      })),
    ],
    sourcePriority: FEASIBILITY_SOURCE_GRADES.map((grade, index) => ({
      grade,
      order: index + 1,
      useWhen: `Synthetic source-priority rule for ${grade}`,
    })),
    contradictionQueries: [
      {
        id: "CQ-01",
        query: "synthetic query for Option A limitations and failures",
        target: "Option A",
        dimension: "risks_failure_modes",
        claimIds: ["CL-01"],
      },
      {
        id: "CQ-02",
        query: "synthetic query for Option B limitations and failures",
        target: "Option B",
        dimension: "risks_failure_modes",
        claimIds: ["CL-02"],
      },
    ],
    alternativeQueries: [{
      id: "AQ-01",
      query: "synthetic materially different alternative approach",
      comparisonNeed: "Compare build, buy, and bounded-scope alternatives",
      dimension: "alternatives",
      claimIds: ["CL-10"],
    }],
    stoppingCriteria: [
      ["SC-01", "DIMENSION_COVERAGE"],
      ["SC-02", "PRIMARY_SOURCE"],
      ["SC-03", "CONTRADICTION"],
      ["SC-04", "ALTERNATIVE"],
      ["SC-05", "CRITICAL_UNKNOWN"],
      ["SC-06", "EVIDENCE_SUFFICIENCY"],
    ].map(([id, kind]) => ({
      id,
      kind,
      description: `Synthetic required stopping criterion ${kind}`,
      required: true,
    })),
  });
}

export function makeFeasibilityResearchReport(): FeasibilityResearchReport {
  const researchPlan = makeFeasibilityResearchPlan();
  const evidence = FEASIBILITY_RESEARCH_DIMENSIONS.map((dimension, index) => ({
    id: `E-${String(index + 1).padStart(2, "0")}`,
    title: `Synthetic reserved-domain evidence for ${dimension}`,
    publisher: index === 0 ? "Synthetic Platform Owner" : "Synthetic Research Institution",
    url: `https://example.invalid/evidence/${dimension}`,
    publishedOn: "2026-08-01",
    accessedOn: "2026-08-24",
    grade: index === 0 ? "A_PRIMARY" as const : "B_AUTHORITATIVE_SECONDARY" as const,
    isPrimary: index === 0,
    dimensions: [dimension],
    claimIds: [`CL-${String(index + 1).padStart(2, "0")}`],
    stance: index === 8 ? "MIXED" as const : "SUPPORTS" as const,
    finding: `Synthetic finding for ${dimension}; not external research evidence.`,
    limitations: "Reserved-domain fixture used only for schema and renderer evaluation.",
  }));
  return feasibilityResearchReportSchema.parse({
    schemaVersion: "projectai-feasibility-research-report-v1",
    skillId: "project-feasibility-research",
    skillVersion: "0.1.0",
    title: "Synthetic Feasibility Research",
    language: "zh",
    researchedOn: "2026-08-24",
    inputMode: "portable_standalone",
    researchPlan,
    researchPasses: FEASIBILITY_RESEARCH_PASSES.map((stage, index) => ({
      stage,
      status: "COMPLETE",
      queryIds: stage === "BREADTH_SCAN"
        ? ["SQ-01"]
        : stage === "PRIMARY_SOURCE_VERIFICATION"
          ? ["SQ-11"]
          : stage === "CONTRADICTION_SEARCH"
            ? ["CQ-01", "CQ-02"]
            : stage === "ALTERNATIVE_SEARCH"
              ? ["AQ-01"]
              : stage === "CRITICAL_UNKNOWN_DEEP_DIVE"
                ? ["SQ-21"]
                : [],
      evidenceIds: index < evidence.length ? [evidence[index].id] : ["E-01"],
      notes: `Synthetic execution note for ${stage}`,
    })),
    executiveConclusion: {
      conclusion: "Synthetic evidence supports only a conditional decision pending a target-platform confirmation.",
      evidenceIds: ["E-01", "E-02"],
    },
    whatWeAreEvaluating: "A synthetic Option A versus Option B project decision.",
    requirementInterpretation: [
      { id: "RI-01", basis: "FACT", statement: "The fixture requests a feasibility decision.", sourceRef: "SRC-01" },
      { id: "RI-02", basis: "GAP", statement: "The target device is not confirmed.", sourceRef: null },
    ],
    optionsConsidered: [
      { id: "O-01", name: "Option A", summary: "Synthetic primary approach", core: true },
      { id: "O-02", name: "Option B", summary: "Synthetic materially different alternative", core: true },
    ],
    feasibilityByDimension: FEASIBILITY_RESEARCH_DIMENSIONS.map((dimension, index) => ({
      dimension,
      status: dimension === "platform_constraints" ? "CONDITIONAL" : "FEASIBLE",
      assessment: `Synthetic assessment for ${dimension}`,
      evidenceIds: [`E-${String(index + 1).padStart(2, "0")}`],
      unknownIds: dimension === "platform_constraints" ? ["U-01"] : [],
    })),
    evidence,
    contradictionChecks: [
      { optionId: "O-01", queryIds: ["CQ-01"], evidenceIds: ["E-09"], finding: "Synthetic limitations were examined for Option A." },
      { optionId: "O-02", queryIds: ["CQ-02"], evidenceIds: ["E-09"], finding: "Synthetic limitations were examined for Option B." },
    ],
    constraints: [{
      id: "CST-01",
      description: "Target platform remains a supplied requirement gap.",
      evidenceIds: ["E-04"],
      interpretationBasis: "GAP",
    }],
    risks: [{
      id: "RK-01",
      description: "The selected option may fail on the unconfirmed target platform.",
      impact: "HIGH",
      likelihood: "UNKNOWN",
      evidenceIds: ["E-09"],
    }],
    unknowns: [{
      id: "U-01",
      description: "Exact target device and platform version",
      priority: "P0",
      blocker: true,
      resolution: "The project owner must confirm the supported device matrix.",
    }],
    costEffortRange: {
      currency: null,
      minimumCost: null,
      maximumCost: null,
      costBasis: "UNKNOWN",
      effortBand: "UNKNOWN",
      effortBasis: "UNKNOWN",
      evidenceIds: [],
      caveats: ["No real commercial quote or delivery estimate exists in this synthetic fixture."],
    },
    recommendedApproach: {
      optionId: "O-01",
      rationale: "Use Option A only after the blocker is confirmed.",
      evidenceIds: ["E-01", "E-02"],
    },
    alternativeApproach: {
      optionId: "O-02",
      rationale: "Retain Option B as the materially different fallback.",
      evidenceIds: ["E-10"],
    },
    decision: {
      verdict: "CONDITIONAL_GO",
      rationale: "The synthetic target-platform blocker remains unresolved.",
      evidenceIds: ["E-01", "E-04"],
      conditionUnknownIds: ["U-01"],
    },
    stoppingCriteriaResults: researchPlan.stoppingCriteria.map((item) => ({
      criterionId: item.id,
      met: true,
      evidence: `Synthetic contract evidence for ${item.kind}`,
    })),
    whatMustBeConfirmedNext: ["U-01"],
  });
}
