import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FEASIBILITY_RESEARCH_DIMENSIONS,
  FEASIBILITY_RESEARCH_MARKDOWN_SECTIONS,
  FEASIBILITY_RESEARCH_PASSES,
  compareFeasibilityResearchAb,
  feasibilityResearchInputSchema,
  feasibilityResearchPlanSchema,
  feasibilityResearchReportSchema,
  renderFeasibilityResearchMarkdown,
} from "@/lib/feasibility-research";
import { makeRequirementAnalysisPack } from "./skill-eval-fixtures/requirement-analysis";
import {
  makeFeasibilityResearchPlan,
  makeFeasibilityResearchReport,
} from "./skill-eval-fixtures/feasibility-research";

test("FR-01 Research Plan covers ten dimensions, query families, source priority, and stopping gates", () => {
  const plan = makeFeasibilityResearchPlan();
  assert.deepEqual(plan.researchDimensions.map((item) => item.dimension), FEASIBILITY_RESEARCH_DIMENSIONS);
  assert.ok(plan.searchQueries.some((item) => item.purpose === "BREADTH"));
  assert.ok(plan.searchQueries.some((item) => item.purpose === "PRIMARY"));
  assert.ok(plan.searchQueries.some((item) => item.purpose === "DEEP_DIVE"));
  assert.ok(plan.contradictionQueries.length > 0);
  assert.ok(plan.alternativeQueries.length > 0);
  assert.equal(plan.stoppingCriteria.length, 6);
});

test("FR-02 Source grading rejects fake Primary and Inference masquerading as a source", () => {
  const fakePrimary = structuredClone(makeFeasibilityResearchReport());
  fakePrimary.evidence[0].isPrimary = false;
  assert.equal(feasibilityResearchReportSchema.safeParse(fakePrimary).success, false);

  const fakeInference = structuredClone(makeFeasibilityResearchReport());
  fakeInference.evidence[0] = {
    ...fakeInference.evidence[0],
    grade: "E_INFERENCE",
    isPrimary: false,
  };
  assert.equal(feasibilityResearchReportSchema.safeParse(fakeInference).success, false);
});

test("FR-03 Fixed Research Protocol order and all stopping criteria are mandatory", () => {
  const report = makeFeasibilityResearchReport();
  assert.deepEqual(report.researchPasses.map((item) => item.stage), FEASIBILITY_RESEARCH_PASSES);

  const reordered = structuredClone(report);
  [reordered.researchPasses[0], reordered.researchPasses[1]] = [
    reordered.researchPasses[1],
    reordered.researchPasses[0],
  ];
  assert.equal(feasibilityResearchReportSchema.safeParse(reordered).success, false);

  const stoppedEarly = structuredClone(report);
  stoppedEarly.stoppingCriteriaResults.pop();
  assert.equal(feasibilityResearchReportSchema.safeParse(stoppedEarly).success, false);

  const skippedPass = structuredClone(report);
  skippedPass.researchPasses[2].queryIds = [];
  assert.equal(feasibilityResearchReportSchema.safeParse(skippedPass).success, false);
});

test("FR-04 Every core option requires its own contradiction search", () => {
  const report = makeFeasibilityResearchReport();
  assert.equal(report.optionsConsidered.filter((item) => item.core).length, 2);
  assert.equal(report.contradictionChecks.length, 2);

  const missingCounter = structuredClone(report);
  missingCounter.contradictionChecks = missingCounter.contradictionChecks.slice(0, 1);
  assert.equal(feasibilityResearchReportSchema.safeParse(missingCounter).success, false);
});

test("FR-05 Recommended and alternative approaches must be materially represented by different options", () => {
  const report = makeFeasibilityResearchReport();
  assert.notEqual(report.recommendedApproach.optionId, report.alternativeApproach.optionId);

  const duplicate = structuredClone(report);
  duplicate.alternativeApproach.optionId = duplicate.recommendedApproach.optionId;
  assert.equal(feasibilityResearchReportSchema.safeParse(duplicate).success, false);
});

test("FR-06 Skill accepts standalone input and a Requirement Analysis Pack without mixing modes", () => {
  const standalone = feasibilityResearchInputSchema.parse({
    schemaVersion: "projectai-feasibility-research-input-v1",
    inputMode: "portable_standalone",
    projectId: null,
    title: "Synthetic standalone research",
    language: "zh",
    currentDate: "2026-08-24",
    decisionQuestion: "Can the synthetic solution meet the target?",
    materials: [{ id: "SRC-01", label: "brief.txt", content: "Synthetic project brief" }],
    requirementAnalysisPack: null,
  });
  assert.equal(standalone.inputMode, "portable_standalone");

  const analysisPack = makeRequirementAnalysisPack({ title: "Synthetic upstream Pack" });
  const packInput = feasibilityResearchInputSchema.parse({
    schemaVersion: "projectai-feasibility-research-input-v1",
    inputMode: "requirement_analysis_pack",
    projectId: null,
    title: "Synthetic Pack research",
    language: "zh",
    currentDate: "2026-08-24",
    decisionQuestion: "Which option is feasible?",
    materials: [],
    requirementAnalysisPack: analysisPack,
  });
  assert.equal(packInput.requirementAnalysisPack?.skillId, "project-requirement-analyst");

  const mixed = { ...standalone, requirementAnalysisPack: analysisPack };
  assert.equal(feasibilityResearchInputSchema.safeParse(mixed).success, false);
});

test("FR-07 A blocker Unknown forbids GO and Conditional Go requires explicit conditions", () => {
  const report = makeFeasibilityResearchReport();
  assert.equal(report.decision.verdict, "CONDITIONAL_GO");
  assert.deepEqual(report.decision.conditionUnknownIds, ["U-01"]);

  const unsupportedGo = structuredClone(report);
  unsupportedGo.decision.verdict = "GO";
  unsupportedGo.decision.conditionUnknownIds = [];
  assert.equal(feasibilityResearchReportSchema.safeParse(unsupportedGo).success, false);

  const noCondition = structuredClone(report);
  noCondition.decision.conditionUnknownIds = [];
  assert.equal(feasibilityResearchReportSchema.safeParse(noCondition).success, false);
});

test("FR-08 Final Markdown exposes all decision sections, links, grades, unknowns, and cost basis", () => {
  const report = makeFeasibilityResearchReport();
  const markdown = renderFeasibilityResearchMarkdown(report);
  for (const section of FEASIBILITY_RESEARCH_MARKDOWN_SECTIONS) assert.match(markdown, new RegExp(section));
  assert.match(markdown, /A_PRIMARY/u);
  assert.match(markdown, /https:\/\/example\.invalid/u);
  assert.match(markdown, /\[BLOCKER\]/u);
  assert.match(markdown, /Cost: UNKNOWN \(UNKNOWN\)/u);
  assert.match(markdown, /\*\*CONDITIONAL_GO\*\*/u);
});

test("Feasibility Plan rejects missing dimensions and unplanned CORE claims", () => {
  const missingDimension = structuredClone(makeFeasibilityResearchPlan());
  missingDimension.researchDimensions.pop();
  assert.equal(feasibilityResearchPlanSchema.safeParse(missingDimension).success, false);

  const unplanned = structuredClone(makeFeasibilityResearchPlan());
  const coreId = unplanned.claimsToVerify.find((item) => item.criticality === "CORE")!.id;
  unplanned.searchQueries = unplanned.searchQueries.filter((item) => !item.claimIds.includes(coreId));
  unplanned.contradictionQueries = unplanned.contradictionQueries.filter((item) => !item.claimIds.includes(coreId));
  unplanned.alternativeQueries = unplanned.alternativeQueries.filter((item) => !item.claimIds.includes(coreId));
  assert.equal(feasibilityResearchPlanSchema.safeParse(unplanned).success, false);
});

test("Feasibility A/B comparator measures required coverage dimensions without declaring a winner", () => {
  const comparison = compareFeasibilityResearchAb(
    {
      runId: "baseline-not-tested",
      method: "ONE_PASS_BASELINE",
      dimensionsCovered: ["product_experience", "technical"],
      firstPartySourceCount: 0,
      authoritativeSecondarySourceCount: 1,
      alternativesConsidered: 0,
      contradictionSearches: 0,
      blockerUnknownsIdentified: 0,
      verdict: "GO",
      conclusionChangedAfterContradiction: false,
    },
    {
      runId: "multi-pass-not-tested",
      method: "MULTI_PASS_SKILL",
      dimensionsCovered: [...FEASIBILITY_RESEARCH_DIMENSIONS],
      firstPartySourceCount: 2,
      authoritativeSecondarySourceCount: 3,
      alternativesConsidered: 2,
      contradictionSearches: 2,
      blockerUnknownsIdentified: 1,
      verdict: "CONDITIONAL_GO",
      conclusionChangedAfterContradiction: true,
    },
  );
  assert.equal(comparison.deltas.dimensionCoverage, 8);
  assert.equal(comparison.deltas.firstPartySources, 2);
  assert.equal(comparison.deltas.alternatives, 2);
  assert.equal(comparison.deltas.contradictionSearches, 2);
  assert.equal(comparison.deltas.blockerUnknowns, 1);
  assert.equal(comparison.verdictChanged, true);
});

test("Feasibility Research Skill and eight portable UAT packs stay synchronized and unexecuted", async () => {
  const skill = await readFile(new URL("../skills/project-feasibility-research/SKILL.md", import.meta.url), "utf8");
  const instruction = [
    "Read SKILL.md first.",
    "Then use only input.json as the supplied project context.",
    "Create the Research Plan before searching.",
    "Follow the full multi-pass Research Protocol in SKILL.md.",
    "Do not invent sources, URLs, facts, prices, or conclusions.",
    "Return only the final Feasibility Research report in Markdown when all stopping criteria are met.",
    "If live search is unavailable, return the Research Plan with RESEARCH_STATUS: NOT_TESTED and do not issue a verdict.",
  ].join("\n") + "\n";
  for (let index = 1; index <= 8; index += 1) {
    const root = new URL(`./feasibility-research-cross-agent/case-${String(index).padStart(2, "0")}/`, import.meta.url);
    const [copiedSkill, copiedInstruction, inputText, expectedText] = await Promise.all([
      readFile(new URL("SKILL.md", root), "utf8"),
      readFile(new URL("RUN_INSTRUCTION.txt", root), "utf8"),
      readFile(new URL("input.json", root), "utf8"),
      readFile(new URL("expected.json", root), "utf8"),
    ]);
    assert.equal(copiedSkill, skill);
    assert.equal(copiedInstruction, instruction);
    assert.equal(feasibilityResearchInputSchema.parse(JSON.parse(inputText)).projectId, null);
    assert.equal(JSON.parse(expectedText).executionStatus, "NOT_TESTED");
  }
});

test("Feasibility A/B pack is executable but truthfully marked NOT_TESTED", async () => {
  const root = new URL("./feasibility-research-cross-agent/ab-comparison/", import.meta.url);
  const [inputText, rubricText, statusText] = await Promise.all([
    readFile(new URL("input.json", root), "utf8"),
    readFile(new URL("SCORING_RUBRIC.json", root), "utf8"),
    readFile(new URL("STATUS.md", root), "utf8"),
  ]);
  feasibilityResearchInputSchema.parse(JSON.parse(inputText));
  const rubric = JSON.parse(rubricText);
  assert.deepEqual(rubric.metrics, [
    "research_dimension_coverage",
    "first_party_sources",
    "alternatives_considered",
    "contradiction_searches",
    "blockers_unknowns_identified",
    "conclusion_change",
  ]);
  assert.match(statusText, /NOT_TESTED/u);
  assert.doesNotMatch(statusText, /PASS/u);
});
