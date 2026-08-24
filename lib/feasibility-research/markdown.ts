import {
  feasibilityResearchPlanSchema,
  feasibilityResearchReportSchema,
  type FeasibilityResearchPlan,
  type FeasibilityResearchReport,
} from "./contracts";

function cell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ").trim() || "/";
}

function row(values: string[]): string {
  return `| ${values.map(cell).join(" | ")} |`;
}

function separator(columns: number): string {
  return `|${Array.from({ length: columns }, () => "---").join("|")}|`;
}

function ids(values: string[]): string {
  return values.join(", ") || "/";
}

function planLines(input: FeasibilityResearchPlan): string[] {
  const plan = feasibilityResearchPlanSchema.parse(input);
  return [
    "## Research Plan",
    "",
    `**Decision Question:** ${plan.decisionQuestion}`,
    "",
    "### Research Dimensions",
    "",
    "| Dimension | Priority | Questions |",
    separator(3),
    ...plan.researchDimensions.map((item) => row([
      item.dimension,
      item.priority,
      item.questions.join("<br>"),
    ])),
    "",
    "### Claims to Verify",
    "",
    ...plan.claimsToVerify.map((item) =>
      `- [${item.criticality}:${item.id}][${item.dimension}] ${item.claim} — ${item.verificationNeed}`),
    "",
    "### Search Queries",
    "",
    ...plan.searchQueries.map((item) =>
      `- [${item.purpose}:${item.id}][${item.dimension}] ${item.query} — Claims: ${ids(item.claimIds)}`),
    "",
    "### Source Priority",
    "",
    ...plan.sourcePriority.map((item) => `- ${item.order}. ${item.grade} — ${item.useWhen}`),
    "",
    "### Contradiction Queries",
    "",
    ...plan.contradictionQueries.map((item) =>
      `- [${item.id}][${item.dimension}] ${item.query} — Target: ${item.target}`),
    "",
    "### Alternative Queries",
    "",
    ...plan.alternativeQueries.map((item) =>
      `- [${item.id}][${item.dimension}] ${item.query} — Compare: ${item.comparisonNeed}`),
    "",
    "### Stopping Criteria",
    "",
    ...plan.stoppingCriteria.map((item) => `- [${item.id}:${item.kind}] ${item.description}`),
  ];
}

export const FEASIBILITY_RESEARCH_MARKDOWN_SECTIONS = [
  "## Research Plan",
  "## Executive Conclusion",
  "## What We Are Evaluating",
  "## Requirement Interpretation",
  "## Options Considered",
  "## Feasibility by Dimension",
  "## Evidence",
  "## Constraints",
  "## Risks",
  "## Unknowns",
  "## Cost / Effort Range",
  "## Recommended Approach",
  "## Alternative Approach",
  "## Decision",
  "## What Must Be Confirmed Next",
] as const;

export function renderFeasibilityResearchPlanMarkdown(input: FeasibilityResearchPlan): string {
  return ["# Feasibility Research Plan", "", ...planLines(input)].join("\n") + "\n";
}

export function renderFeasibilityResearchMarkdown(input: FeasibilityResearchReport): string {
  const report = feasibilityResearchReportSchema.parse(input);
  const evidenceLink = (id: string) => {
    const item = report.evidence.find((entry) => entry.id === id);
    if (!item) return id;
    return item.url ? `[${id}](${item.url})` : id;
  };
  const evidenceRefs = (values: string[]) => values.map(evidenceLink).join(", ") || "/";
  return [
    "# Project Feasibility Research",
    "",
    `**Title:** ${report.title}`,
    `**Researched On:** ${report.researchedOn}`,
    `**Input Mode:** ${report.inputMode}`,
    "",
    ...planLines(report.researchPlan),
    "",
    "### Research Protocol Execution",
    "",
    "| Stage | Status | Query IDs | Evidence IDs | Notes |",
    separator(5),
    ...report.researchPasses.map((item) => row([
      item.stage,
      item.status,
      ids(item.queryIds),
      ids(item.evidenceIds),
      item.notes,
    ])),
    "",
    "## Executive Conclusion",
    "",
    report.executiveConclusion.conclusion,
    "",
    `Evidence: ${evidenceRefs(report.executiveConclusion.evidenceIds)}`,
    "",
    "## What We Are Evaluating",
    "",
    report.whatWeAreEvaluating,
    "",
    "## Requirement Interpretation",
    "",
    ...report.requirementInterpretation.map((item) =>
      `- [${item.basis}:${item.id}] ${item.statement}` + (item.sourceRef ? ` — Source: ${item.sourceRef}` : "")),
    "",
    "## Options Considered",
    "",
    "| Option ID | Name | Core | Summary |",
    separator(4),
    ...report.optionsConsidered.map((item) => row([
      item.id,
      item.name,
      item.core ? "yes" : "no",
      item.summary,
    ])),
    "",
    "## Feasibility by Dimension",
    "",
    "| Dimension | Status | Assessment | Evidence | Unknowns |",
    separator(5),
    ...report.feasibilityByDimension.map((item) => row([
      item.dimension,
      item.status,
      item.assessment,
      evidenceRefs(item.evidenceIds),
      ids(item.unknownIds),
    ])),
    "",
    "## Evidence",
    "",
    "| ID | Grade | Source | Date | Stance | Finding | Limitations |",
    separator(7),
    ...report.evidence.map((item) => row([
      item.id,
      item.grade,
      item.url ? `[${item.title}](${item.url}) — ${item.publisher}` : item.title,
      item.publishedOn ?? `accessed ${item.accessedOn}`,
      item.stance,
      item.finding,
      item.limitations,
    ])),
    "",
    "### Contradiction Checks",
    "",
    ...report.contradictionChecks.map((item) =>
      `- [${item.optionId}] Queries: ${ids(item.queryIds)} — ${item.finding} — Evidence: ${evidenceRefs(item.evidenceIds)}`),
    "",
    "## Constraints",
    "",
    ...(report.constraints.length > 0
      ? report.constraints.map((item) =>
        `- [${item.interpretationBasis}:${item.id}] ${item.description} — Evidence: ${evidenceRefs(item.evidenceIds)}`)
      : ["/"]),
    "",
    "## Risks",
    "",
    ...(report.risks.length > 0
      ? report.risks.map((item) =>
        `- [${item.id}][Impact ${item.impact} / Likelihood ${item.likelihood}] ${item.description} — Evidence: ${evidenceRefs(item.evidenceIds)}`)
      : ["/"]),
    "",
    "## Unknowns",
    "",
    ...(report.unknowns.length > 0
      ? report.unknowns.map((item) =>
        `- [${item.priority}:${item.id}]${item.blocker ? "[BLOCKER]" : ""} ${item.description} — Resolve: ${item.resolution}`)
      : ["/"]),
    "",
    "## Cost / Effort Range",
    "",
    `- Cost: ${report.costEffortRange.minimumCost === null
      ? "UNKNOWN"
      : `${report.costEffortRange.currency} ${report.costEffortRange.minimumCost}–${report.costEffortRange.maximumCost}`} (${report.costEffortRange.costBasis})`,
    `- Effort: ${report.costEffortRange.effortBand} (${report.costEffortRange.effortBasis})`,
    `- Evidence: ${evidenceRefs(report.costEffortRange.evidenceIds)}`,
    ...report.costEffortRange.caveats.map((item) => `- Caveat: ${item}`),
    "",
    "## Recommended Approach",
    "",
    `[${report.recommendedApproach.optionId}] ${report.recommendedApproach.rationale}`,
    "",
    `Evidence: ${evidenceRefs(report.recommendedApproach.evidenceIds)}`,
    "",
    "## Alternative Approach",
    "",
    `[${report.alternativeApproach.optionId}] ${report.alternativeApproach.rationale}`,
    "",
    `Evidence: ${evidenceRefs(report.alternativeApproach.evidenceIds)}`,
    "",
    "## Decision",
    "",
    `**${report.decision.verdict}** — ${report.decision.rationale}`,
    "",
    `Conditions: ${ids(report.decision.conditionUnknownIds)}`,
    `Evidence: ${evidenceRefs(report.decision.evidenceIds)}`,
    "",
    "### Stopping Criteria Results",
    "",
    ...report.stoppingCriteriaResults.map((item) =>
      `- [MET:${item.criterionId}] ${item.evidence}`),
    "",
    "## What Must Be Confirmed Next",
    "",
    ...(report.whatMustBeConfirmedNext.length > 0
      ? report.whatMustBeConfirmedNext.map((id) => {
        const unknown = report.unknowns.find((item) => item.id === id);
        return `- [${id}] ${unknown?.description ?? "Unknown"} — ${unknown?.resolution ?? "Confirm"}`;
      })
      : ["/"]),
    "",
  ].join("\n");
}
