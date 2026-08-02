import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  REQUIREMENT_OVERVIEW_FIELD_REGISTRY,
  parseRequirementOverviewCandidateItems,
  renderRequirementOverviewMarkdown,
} from "../lib/focused-mvp/requirement-overview";
import type { RequirementOverviewItem } from "../lib/db/schema";

const blankItems = (): RequirementOverviewItem[] => REQUIREMENT_OVERVIEW_FIELD_REGISTRY.map((field) => ({
  id: field.key,
  label: field.exactLabel,
  status: "missing",
  value: "",
  citationLabels: [],
}));

test("requirement overview renderer matches the fixed user template snapshot", async () => {
  const expected = await readFile(new URL("./fixtures/requirement-overview-template.snapshot.md", import.meta.url), "utf8");
  const actual = renderRequirementOverviewMarkdown("{项目名称}", blankItems()).trim();
  assert.equal(actual, expected.trim());
  assert.equal(REQUIREMENT_OVERVIEW_FIELD_REGISTRY.filter((field) => field.section === "项目背景").length, 15);
  assert.equal(REQUIREMENT_OVERVIEW_FIELD_REGISTRY.filter((field) => field.section === "需求概览").length, 9);
});

test("renderer keeps statuses and citations inside fixed table cells", () => {
  const items = blankItems().map((item) => {
    if (item.id === "project_region") return { ...item, status: "confirmed" as const, value: "中国", citationLabels: ["E1"] };
    if (item.id === "platform_type") return { ...item, status: "inferred" as const, value: "微信小程序", citationLabels: ["E2"] };
    if (item.id === "mvp_requirements") return { ...item, status: "user_confirmed" as const, value: "会员注册和 CRM 同步", citationLabels: ["E3"] };
    if (item.id === "feasibility_analysis") return { ...item, status: "conflict" as const, alternatives: [{ value: "可行", citationLabels: ["E4"] }, { value: "需提供替代方案", citationLabels: ["E5"] }] };
    return item;
  });
  const markdown = renderRequirementOverviewMarkdown("模板测试", items);
  assert.match(markdown, /\|项目地区\|中国<br>来源：\[E1\]\|/);
  assert.match(markdown, /\|平台类型\|AI 推断（待确认）：微信小程序<br>依据：\[E2\]\|/);
  assert.match(markdown, /\|7\|MVP需求\|会员注册和 CRM 同步<br>状态：项目经理已确认。<br>来源：\[E3\]\|/);
  assert.match(markdown, /\|6\|可行性分析\|存在冲突，待项目经理确认：<br>- 可行<br>来源：\[E4\]<br>- 需提供替代方案<br>来源：\[E5\]\|/);
  for (const forbidden of ["## 已确认", "## AI 推断", "## 信息缺口与冲突", "## 目标与成功标准", "## 用户与关键场景", "## 范围与交付物", "## 负责人"]) {
    assert.doesNotMatch(markdown, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("renderer ignores unknown model fields and always renders all 24 registry fields", () => {
  const markdown = renderRequirementOverviewMarkdown("模板测试", [
    ...blankItems(),
    { id: "goals", label: "目标与成功标准", status: "confirmed", value: "不得进入正式文档", citationLabels: [] },
  ]);
  assert.doesNotMatch(markdown, /目标与成功标准/);
  assert.equal(markdown.split("\n").filter((line) => line.startsWith("|") && !line.startsWith("|---")).length, 26);
});

test("comparison candidates keep the fixed field registry, citations, and manager-confirmed values", () => {
  const initial = blankItems();
  initial[0] = { ...initial[0], status: "user_confirmed", value: "项目经理确认的时间", citationLabels: [] };
  const candidate = {
    items: REQUIREMENT_OVERVIEW_FIELD_REGISTRY.map((field) => ({
      id: field.key,
      label: "模型尝试改写的标签",
      status: "inferred",
      value: `${field.exactLabel} 的受控候选`,
      citationLabels: ["E1"],
    })),
  };
  const parsed = parseRequirementOverviewCandidateItems(JSON.stringify(candidate), initial, new Set(["E1"]));
  assert.equal(parsed.length, REQUIREMENT_OVERVIEW_FIELD_REGISTRY.length);
  assert.deepEqual(parsed[0], initial[0]);
  assert.equal(parsed[1]?.label, REQUIREMENT_OVERVIEW_FIELD_REGISTRY[1]?.exactLabel);
});

test("comparison candidates reject an altered field list or an out-of-scope citation", () => {
  const item = blankItems()[0]!;
  const invalidRegistry = JSON.stringify({ items: [{ ...item, citationLabels: ["E1"] }] });
  assert.throws(() => parseRequirementOverviewCandidateItems(invalidRegistry, blankItems(), new Set(["E1"])), /候选模型未返回固定需求概览格式|固定需求概览字段/);
  const invalidCitation = JSON.stringify({ items: REQUIREMENT_OVERVIEW_FIELD_REGISTRY.map((field) => ({ id: field.key, label: field.exactLabel, status: "inferred", value: "候选", citationLabels: ["E2"] })) });
  assert.throws(() => parseRequirementOverviewCandidateItems(invalidCitation, blankItems(), new Set(["E1"])), /当前资料范围以外/);
});
