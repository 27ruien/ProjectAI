import {
  requirementAnalysisPackSchema,
  type RequirementAnalysisPack,
} from "./contracts";

function cell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ").trim() || "/";
}

function refs(values: string[]): string {
  return values.join(", ") || "/";
}

function row(values: string[]): string {
  return `| ${values.map(cell).join(" | ")} |`;
}

function separator(columns: number): string {
  return `|${Array.from({ length: columns }, () => "---").join("|")}|`;
}

export const REQUIREMENT_ANALYSIS_MARKDOWN_SECTIONS = [
  "## Requirement Summary",
  "## User Journey Draft",
  "## Functional Scope Draft",
  "## Requirement Matrix",
  "## Missing Information",
  "## Critical Questions",
  "## Dependencies",
  "## Risks / Unknowns",
  "## Initial Scope Boundary",
  "## Suggested Next Step",
] as const;

export function renderRequirementAnalysisMarkdown(input: RequirementAnalysisPack): string {
  const pack = requirementAnalysisPackSchema.parse(input);
  const scopeRows = (disposition: string) => pack.functionalScopeDraft
    .filter((item) => item.disposition === disposition)
    .map((item) => `- [${item.basis}:${item.id}] ${item.title} — ${item.rationale} (${refs(item.statementIds)})`);
  return [
    "# Requirement Analysis Pack",
    "",
    `**Title:** ${pack.title}`,
    `**Source Material IDs:** ${refs(pack.sourceMaterialIds)}`,
    "",
    "## Requirement Summary",
    "",
    pack.requirementSummary.summary,
    "",
    "### Evidence Register",
    "",
    ...pack.statements.map((item) =>
      `- [${item.basis}:${item.id}][${item.domain}] ${item.statement} — ${item.reason}` +
      (item.sourceEvidence ? ` — Evidence: ${item.sourceEvidence}` : "")),
    "",
    "### Controlled Coverage",
    "",
    "| Domain | Coverage | Statement IDs | Rationale |",
    separator(4),
    ...pack.domainAssessments.map((item) => row([
      item.domain,
      item.coverage,
      refs(item.statementIds),
      item.rationale,
    ])),
    "",
    "## User Journey Draft",
    "",
    ...(pack.userJourneyDraft.length > 0
      ? [...pack.userJourneyDraft]
        .sort((a, b) => a.order - b.order)
        .map((item) =>
          `${item.order}. [${item.basis}:${item.id}] ${item.actor} — ${item.action} → ${item.outcome} (${refs(item.statementIds)})`)
      : ["/"]),
    "",
    "## Functional Scope Draft",
    "",
    "### In Scope",
    ...scopeRows("IN_SCOPE"),
    ...(scopeRows("IN_SCOPE").length === 0 ? ["/"] : []),
    "",
    "### Out of Scope",
    ...scopeRows("OUT_OF_SCOPE"),
    ...(scopeRows("OUT_OF_SCOPE").length === 0 ? ["/"] : []),
    "",
    "### Deferred",
    ...scopeRows("DEFERRED"),
    ...(scopeRows("DEFERRED").length === 0 ? ["/"] : []),
    "",
    "### Unresolved",
    ...scopeRows("UNRESOLVED"),
    ...(scopeRows("UNRESOLVED").length === 0 ? ["/"] : []),
    "",
    "## Requirement Matrix",
    "",
    "| ID | Domain | Requirement | Basis | Status | Priority | Acceptance Signal | Statement IDs |",
    separator(8),
    ...pack.requirementMatrix.map((item) => row([
      item.id,
      item.domain,
      item.requirement,
      item.basis,
      item.status,
      item.priority,
      item.acceptanceSignal ?? "/",
      refs(item.statementIds),
    ])),
    "",
    "## Missing Information",
    "",
    ...(pack.missingInformation.length > 0
      ? pack.missingInformation.map((item) =>
        `- [${item.priority}:${item.id}] ${item.description} — Impact: ${item.impact} (${refs(item.gapStatementIds)})`)
      : ["/"]),
    "",
    "## Critical Questions",
    "",
    ...(pack.criticalQuestions.length > 0
      ? pack.criticalQuestions.map((item) =>
        `- [${item.priority}:${item.id}] ${item.question} — Why: ${item.why} — Resolves: ${refs(item.resolvesGapStatementIds)}`)
      : ["/"]),
    "",
    "## Dependencies",
    "",
    ...(pack.dependencies.length > 0
      ? pack.dependencies.map((item) =>
        `- [${item.basis}:${item.id}] ${item.description} — Impact: ${item.impact} (${refs(item.statementIds)})`)
      : ["/"]),
    "",
    "## Risks / Unknowns",
    "",
    ...(pack.risksUnknowns.length > 0
      ? pack.risksUnknowns.map((item) =>
        `- [${item.priority}:${item.kind}:${item.basis}:${item.id}] ${item.description} — Impact: ${item.impact} (${refs(item.statementIds)})`)
      : ["/"]),
    "",
    "## Initial Scope Boundary",
    "",
    `- In Scope: ${refs(pack.initialScopeBoundary.inScopeIds)}`,
    `- Out of Scope: ${refs(pack.initialScopeBoundary.outOfScopeIds)}`,
    `- Deferred: ${refs(pack.initialScopeBoundary.deferredIds)}`,
    `- Unresolved: ${refs(pack.initialScopeBoundary.unresolvedIds)}`,
    "",
    "## Suggested Next Step",
    "",
    `[${pack.suggestedNextStep.basis}] ${pack.suggestedNextStep.action} ` +
      `(${refs(pack.suggestedNextStep.statementIds)}; ` +
      `User confirmation: ${pack.suggestedNextStep.requiresUserConfirmation ? "required" : "not required"})`,
    "",
    ...(pack.warnings.length > 0 ? ["### Warnings", "", ...pack.warnings.map((item) => `- ${item}`), ""] : []),
  ].join("\n");
}
