import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REQUIREMENT_ANALYSIS_MARKDOWN_SECTIONS,
  REQUIREMENT_ANALYST_SKILL_VERSION,
  assertRequirementDomainCatalogComplete,
  renderRequirementAnalysisMarkdown,
  requirementAnalysisInputSchema,
  requirementAnalysisPackSchema,
} from "@/lib/requirement-analyst";
import { makeRequirementAnalysisPack } from "./skill-eval-fixtures/requirement-analysis";

test("RA-01 Vague campaign preserves sparse facts and raises P0 core gaps", () => {
  const source = requirementAnalysisInputSchema.parse({
    schemaVersion: "projectai-requirement-analysis-input-v1",
    inputMode: "portable_user_supplied",
    projectId: null,
    title: "Synthetic vague campaign",
    language: "zh",
    materials: [{ id: "SRC-01", label: "brief.txt", content: "做一个会员活动页，下个月上线。" }],
    requestedOutcome: "Clarify requirements",
  });
  assert.equal(source.projectId, null);
  const pack = makeRequirementAnalysisPack({
    title: source.title,
    coverage: { deliverable: "PARTIAL", deadline: "PARTIAL" },
    factText: { deliverable: "会员活动页", deadline: "下个月上线，但没有精确日期" },
    gapText: { deadline: "Exact launch date is not supplied" },
  });
  assert.equal(pack.statements.find((item) => item.domain === "deliverable" && item.basis === "FACT")?.statement, "会员活动页");
  assert.ok(pack.criticalQuestions.some((item) => item.priority === "P0"));
  assert.ok(pack.missingInformation.some((item) => item.domain === "business_goal"));
});

test("RA-02 User journey keeps confirmed user and scenario separate from missing failure flow", () => {
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic B2B dashboard",
    coverage: {
      business_goal: "COMPLETE",
      user: "COMPLETE",
      scenario: "COMPLETE",
      user_journey: "PARTIAL",
    },
    factText: {
      business_goal: "Reduce weekly inventory reconciliation time",
      user: "Regional inventory manager",
      scenario: "Manager reviews exceptions every Monday",
      user_journey: "Manager opens the dashboard and reviews exception rows",
    },
    gapText: { user_journey: "Error recovery and completion confirmation are absent" },
  });
  assert.equal(pack.domainAssessments.find((item) => item.domain === "user_journey")?.coverage, "PARTIAL");
  assert.ok(pack.statements.some((item) => item.domain === "user" && item.basis === "FACT"));
  assert.ok(pack.statements.some((item) => item.domain === "user_journey" && item.basis === "GAP"));
});

test("RA-03 AI and data case exposes evidence, review, and permission gaps without inventing behavior", () => {
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic AI assistant",
    coverage: {
      ai_behavior: "PARTIAL",
      data: "PARTIAL",
      identity_permission: "MISSING",
    },
    factText: {
      ai_behavior: "AI drafts a response from supplied support text",
      data: "Input includes customer support text",
    },
    gapText: {
      ai_behavior: "Evidence, failure behavior, and human review are not defined",
      data: "Retention and deletion are not defined",
      identity_permission: "Roles and read/write boundaries are not defined",
    },
  });
  const serialized = JSON.stringify(pack);
  assert.match(serialized, /human review/u);
  assert.doesNotMatch(serialized, /保存30天|自动批准|管理员可查看全部/u);
});

test("RA-04 Third-party integration produces dependency and prioritized questions", () => {
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic API integration",
    coverage: {
      third_party_integration: "PARTIAL",
      project_dependency: "PARTIAL",
    },
    factText: {
      third_party_integration: "The project must integrate with Partner API",
      project_dependency: "Partner API access is a dependency",
    },
    gapText: {
      third_party_integration: "API documentation, authentication, and test environment are missing",
      project_dependency: "Dependency owner and delivery date are unknown",
    },
  });
  assert.ok(pack.dependencies.some((item) => item.basis === "GAP"));
  assert.ok(pack.criticalQuestions.some((item) =>
    item.resolvesGapStatementIds.some((id) =>
      pack.statements.find((statement) => statement.id === id)?.domain === "third_party_integration")));
});

test("RA-05 Explicit deadline and constraint stay FACT and are not expanded", () => {
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic fixed launch",
    coverage: { deadline: "COMPLETE", constraint: "COMPLETE" },
    factText: {
      deadline: "Launch date is 2026-09-30",
      constraint: "Phase 1 is Web only",
    },
  });
  assert.equal(pack.statements.find((item) => item.domain === "deadline")?.statement, "Launch date is 2026-09-30");
  assert.equal(pack.statements.find((item) => item.domain === "constraint")?.statement, "Phase 1 is Web only");
  assert.doesNotMatch(JSON.stringify(pack), /2026-09-29|native app is included/u);
});

test("RA-06 Conflicting identity statements remain a GAP rather than a silent resolution", () => {
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic identity conflict",
    coverage: { identity_permission: "PARTIAL" },
    factText: { identity_permission: "Sources conflict: no login vs member reward history" },
    gapText: { identity_permission: "Identity and authentication approach require confirmation" },
  });
  const assessment = pack.domainAssessments.find((item) => item.domain === "identity_permission");
  assert.equal(assessment?.coverage, "PARTIAL");
  assert.ok(assessment?.statementIds.some((id) => id.startsWith("G-")));
});

test("RA-07 Explicit exclusions map to the initial scope boundary", () => {
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic scope exclusion",
    coverage: { functional_scope: "NOT_APPLICABLE" },
    factText: { functional_scope: "Native apps are explicitly out of Phase 1 scope" },
  });
  assert.deepEqual(pack.initialScopeBoundary.outOfScopeIds, ["S-01"]);
  assert.equal(pack.functionalScopeDraft[0].basis, "FACT");
  assert.equal(pack.functionalScopeDraft[0].disposition, "OUT_OF_SCOPE");
});

test("RA-08 Planning assumption stays visible and forces user confirmation", () => {
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic assumed channel",
    coverage: {
      business_goal: "COMPLETE",
      user: "COMPLETE",
      scenario: "COMPLETE",
      deliverable: "COMPLETE",
      success_metric: "COMPLETE",
      channel: "ASSUMED",
      deadline: "COMPLETE",
      constraint: "COMPLETE",
      user_journey: "COMPLETE",
      functional_scope: "COMPLETE",
      identity_permission: "COMPLETE",
      data: "COMPLETE",
      ai_behavior: "COMPLETE",
      third_party_integration: "COMPLETE",
      content_asset: "COMPLETE",
      operations_rules: "COMPLETE",
      test_launch: "COMPLETE",
      project_dependency: "COMPLETE",
    },
    assumptionText: { channel: "Assume responsive Web for discussion" },
  });
  const assumption = pack.statements.find((item) => item.basis === "ASSUMPTION");
  assert.equal(assumption?.sourceEvidence, null);
  assert.equal(pack.suggestedNextStep.basis, "ASSUMPTION");
  assert.equal(pack.suggestedNextStep.requiresUserConfirmation, true);
});

test("RA-09 produces usable business concepts, functional scope, user flow, and information architecture", () => {
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic product decomposition",
    coverage: {
      deliverable: "COMPLETE",
      functional_scope: "ASSUMED",
      user_journey: "ASSUMED",
    },
    factText: { deliverable: "会员活动页" },
    assumptionText: {
      functional_scope: "Assume a primary member interaction for discussion",
      user_journey: "Assume an entry-to-completion flow for discussion",
    },
  });
  assert.equal(REQUIREMENT_ANALYST_SKILL_VERSION, "0.2.0");
  assert.equal(pack.businessConcepts[0]?.name, "会员活动页");
  assert.equal(pack.functionalScopeDraft[0]?.disposition, "UNRESOLVED");
  assert.match(pack.functionalScopeDraft[0]?.notes ?? "", /not confirmed scope/u);
  assert.equal(pack.informationArchitecture[0]?.parentId, null);

  const markdown = renderRequirementAnalysisMarkdown(pack);
  assert.match(markdown, /# 需求分析产出包/u);
  assert.match(markdown, /\| 序号 \| 核心业务概念 \| 概念定义 \|/u);
  assert.match(markdown, /\| 序号 \| 角色 \| 操作\/步骤 \| 结果\/反馈 \|/u);
  assert.match(markdown, /\| 序号 \| 端 \| 功能模块 \| 功能说明 \| 范围状态 \| 依据 \| 备注 \|/u);
  assert.match(markdown, /## 信息架构/u);
  assert.doesNotMatch(markdown, /```mermaid|<img|!\[/u);
});

test("Requirement Analysis contract rejects untraceable facts and incomplete framework coverage", () => {
  const pack = makeRequirementAnalysisPack({ title: "Synthetic negative control" });
  const noEvidence = structuredClone(pack);
  const fact = noEvidence.statements.find((item) => item.basis === "FACT");
  if (fact) fact.sourceEvidence = null;
  else {
    noEvidence.statements[0] = {
      ...noEvidence.statements[0],
      id: "F-99",
      basis: "FACT",
      sourceEvidence: null,
      sourceIds: ["SRC-01"],
    };
  }
  assert.equal(requirementAnalysisPackSchema.safeParse(noEvidence).success, false);

  const incomplete = structuredClone(pack);
  incomplete.domainAssessments.pop();
  assert.equal(requirementAnalysisPackSchema.safeParse(incomplete).success, false);

  const silentlyResolved = structuredClone(pack);
  silentlyResolved.requirementMatrix[0].basis = "GAP";
  silentlyResolved.requirementMatrix[0].status = "CONFIRMED";
  assert.equal(requirementAnalysisPackSchema.safeParse(silentlyResolved).success, false);

  const inventedArchitecture = structuredClone(pack);
  const unrelated = inventedArchitecture.statements.find((item) => item.domain === "data");
  if (unrelated) {
    inventedArchitecture.informationArchitecture[0].basis = unrelated.basis;
    inventedArchitecture.informationArchitecture[0].statementIds = [unrelated.id];
  }
  assert.equal(requirementAnalysisPackSchema.safeParse(inventedArchitecture).success, false);
});

test("Requirement Analysis renderer exposes every required section and evidence class", () => {
  assertRequirementDomainCatalogComplete();
  const pack = makeRequirementAnalysisPack({
    title: "Synthetic renderer",
    coverage: { business_goal: "COMPLETE", channel: "ASSUMED" },
  });
  const markdown = renderRequirementAnalysisMarkdown(pack);
  for (const section of REQUIREMENT_ANALYSIS_MARKDOWN_SECTIONS) assert.match(markdown, new RegExp(section));
  assert.match(markdown, /\[FACT:F-/u);
  assert.match(markdown, /\[GAP:G-/u);
  assert.match(markdown, /\[ASSUMPTION:A-/u);
  assert.match(markdown, /\[P0:Q-/u);
});

test("Requirement Analyst Skill and eight portable UAT packs stay synchronized", async () => {
  const skill = await readFile(new URL("../skills/project-requirement-analyst/SKILL.md", import.meta.url), "utf8");
  const instruction = [
    "Read SKILL.md first.",
    "Then use only input.json as the factual source.",
    "Follow all rules in SKILL.md.",
    "Do not use external project knowledge.",
    "Do not invent missing facts.",
    "Return only the final Simplified Chinese Requirement Analysis Pack in Markdown.",
    "Do not generate images or Mermaid.",
  ].join("\n") + "\n";
  for (let index = 1; index <= 8; index += 1) {
    const root = new URL(`./requirement-analyst-cross-agent/case-${String(index).padStart(2, "0")}/`, import.meta.url);
    const [copiedSkill, copiedInstruction, inputText, expectedText] = await Promise.all([
      readFile(new URL("SKILL.md", root), "utf8"),
      readFile(new URL("RUN_INSTRUCTION.txt", root), "utf8"),
      readFile(new URL("input.json", root), "utf8"),
      readFile(new URL("expected.json", root), "utf8"),
    ]);
    assert.equal(copiedSkill, skill);
    assert.equal(copiedInstruction, instruction);
    assert.equal(requirementAnalysisInputSchema.parse(JSON.parse(inputText)).projectId, null);
    const expected = JSON.parse(expectedText) as {
      executionStatus: string;
      globalPassCriteria: string[];
    };
    assert.equal(expected.executionStatus, "NOT_TESTED");
    assert.ok(expected.globalPassCriteria.some((item) => /thirteen required output sections/u.test(item)));
    assert.ok(expected.globalPassCriteria.some((item) => /Functional Scope is a Markdown table/u.test(item)));
  }
});
