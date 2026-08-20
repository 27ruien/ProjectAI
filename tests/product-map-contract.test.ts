import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  PRODUCT_MAP_EXCEPTION_KINDS,
  PRODUCT_MAP_SKILL_FILE_SHA256,
  PRODUCT_MAP_STEP_IDS,
  PRODUCT_MAP_STEP_SCHEMAS,
  productMapAnalysisContractSchema,
  productMapConfigInputSchema,
  runProductMapStructureLint,
} from "../lib/product-map/contracts";
import { fakeProductMapResponse } from "../lib/product-map/fake-output";
import { productMapSkillRegistry } from "../lib/product-map/registry";
import {
  PRODUCT_MAP_AI_LIMIT_DEFAULTS,
  getProductMapAiLimits,
} from "../lib/product-map/config";

function coverage(items: Array<{ evidenceStatus: string }>) {
  const counts = {
    confirmed: items.filter((item) => item.evidenceStatus === "CONFIRMED")
      .length,
    inferred: items.filter((item) => item.evidenceStatus === "INFERRED").length,
    missing: items.filter((item) => item.evidenceStatus === "MISSING").length,
    conflict: items.filter((item) => item.evidenceStatus === "CONFLICT").length,
    notApplicable: items.filter(
      (item) => item.evidenceStatus === "NOT_APPLICABLE",
    ).length,
  };
  const applicable = items.length - counts.notApplicable;
  return {
    ...counts,
    percentage: applicable
      ? Math.round((counts.confirmed / applicable) * 100)
      : 100,
  };
}

function validAnalysisContract() {
  const sources = [
    {
      id: "S1",
      kind: "project_document",
      label: "虚构项目资料",
      evidenceStatus: "CONFIRMED",
      citationIds: ["E1"],
    },
    {
      id: "S2",
      kind: "company_document",
      label: "虚构公司资料",
      evidenceStatus: "CONFIRMED",
      citationIds: ["E2"],
    },
  ] as const;
  const goalLinks = [
    {
      businessGoalId: "BG1",
      userGoalId: "UG1",
      statement: "减少需求理解偏差",
      currentSolution: "可审核产品结构草稿",
      evidenceStatus: "INFERRED",
      sourceRefs: ["S1"],
    },
  ] as const;
  const scope = {
    inScope: [
      {
        statement: "生成可审核草稿",
        evidenceStatus: "CONFIRMED",
        sourceRefs: ["S1"],
      },
    ],
    outOfScope: [
      {
        statement: "自动覆盖正式业务数据",
        evidenceStatus: "NOT_APPLICABLE",
        sourceRefs: [],
      },
    ],
    tbd: [{ statement: "上线指标", evidenceStatus: "MISSING", sourceRefs: [] }],
    dependencies: [
      {
        statement: "资料中的依赖定义冲突",
        evidenceStatus: "CONFLICT",
        sourceRefs: ["S1", "S2"],
      },
    ],
  } as const;
  const roles = [
    {
      role: "项目经理",
      roleType: "user",
      canView: ["草稿"],
      canOperate: ["执行"],
      canModify: ["编辑"],
      canConfirm: ["审核"],
      canDelete: ["取消"],
      evidenceStatus: "INFERRED",
      sourceRefs: ["S1"],
    },
  ] as const;
  const exceptionPaths = PRODUCT_MAP_EXCEPTION_KINDS.map((kind, index) => ({
    id: `EX${index + 1}`,
    kind,
    trigger: `${kind} 触发`,
    expectedHandling:
      kind === "happy_path" ? "完成正常流程" : "保留并提示项目经理",
    terminalState: kind === "happy_path" ? "success" : "待确认",
    evidenceStatus:
      kind === "happy_path"
        ? ("CONFIRMED" as const)
        : ("NOT_APPLICABLE" as const),
    sourceRefs: kind === "happy_path" ? ["S1"] : [],
  }));
  const items = [
    ...sources,
    ...goalLinks,
    ...scope.inScope,
    ...scope.outOfScope,
    ...scope.tbd,
    ...scope.dependencies,
    ...roles,
    ...exceptionPaths,
  ];
  return {
    sources,
    goalLinks,
    scope,
    roles,
    exceptionPaths,
    evidenceCoverage: coverage(items),
  };
}

describe("Product Map contract", () => {
  it("rejects caller-controlled model and provider fields", () => {
    const base = {
      projectId: "project-a",
      selectedSourceIds: [],
      idempotencyKey: "contract-key",
    };
    assert.equal(productMapConfigInputSchema.safeParse(base).success, true);
    for (const field of [
      "provider",
      "model",
      "modelProfileId",
      "region",
      "apiKey",
    ]) {
      assert.equal(
        productMapConfigInputSchema.safeParse({ ...base, [field]: "forbidden" })
          .success,
        false,
        field,
      );
    }
  });

  it("enforces five-state evidence semantics, stable IDs, source refs, coverage, and all paths", () => {
    const value = validAnalysisContract();
    assert.equal(
      productMapAnalysisContractSchema.safeParse(value).success,
      true,
    );
    assert.equal(value.exceptionPaths.length, 13);
    assert.equal(
      productMapAnalysisContractSchema.safeParse({
        ...value,
        goalLinks: [{ ...value.goalLinks[0], sourceRefs: [] }],
      }).success,
      false,
    );
    assert.equal(
      productMapAnalysisContractSchema.safeParse({
        ...value,
        scope: {
          ...value.scope,
          dependencies: [
            { ...value.scope.dependencies[0], sourceRefs: ["S404", "S2"] },
          ],
        },
      }).success,
      false,
    );
    assert.equal(
      productMapAnalysisContractSchema.safeParse({
        ...value,
        evidenceCoverage: { ...value.evidenceCoverage, percentage: 60 },
      }).success,
      false,
    );
    assert.equal(
      productMapAnalysisContractSchema.safeParse({
        ...value,
        exceptionPaths: value.exceptionPaths.slice(0, 12),
      }).success,
      false,
    );
  });

  it("keeps all generated intermediate steps schema-valid and returns every evidence state", () => {
    for (const stepId of PRODUCT_MAP_STEP_IDS.slice(0, 6)) {
      const prompt = `<product_map_step_json>${JSON.stringify({ stepId })}</product_map_step_json><product_map_source_ids_json>["S1","S2","S3"]</product_map_source_ids_json>`;
      const output = JSON.parse(fakeProductMapResponse(prompt));
      assert.equal(
        PRODUCT_MAP_STEP_SCHEMAS[stepId].safeParse(output).success,
        true,
        stepId,
      );
    }
    const final = JSON.parse(
      fakeProductMapResponse(
        `<product_map_step_json>{"stepId":"final_artifact"}</product_map_step_json><product_map_source_ids_json>["S1","S2","S3"]</product_map_source_ids_json>`,
      ),
    ) as {
      analysisContract: {
        sources: Array<{ evidenceStatus: string }>;
        goalLinks: Array<{ evidenceStatus: string }>;
        scope: Record<string, Array<{ evidenceStatus: string }>>;
        roles: Array<{ evidenceStatus: string }>;
        exceptionPaths: Array<{ evidenceStatus: string }>;
      };
    };
    const statuses = new Set(
      [
        ...final.analysisContract.sources,
        ...final.analysisContract.goalLinks,
        ...Object.values(final.analysisContract.scope).flat(),
        ...final.analysisContract.roles,
        ...final.analysisContract.exceptionPaths,
      ].map((item) => item.evidenceStatus),
    );
    assert.deepEqual(
      [...statuses].sort(),
      ["CONFIRMED", "CONFLICT", "INFERRED", "MISSING", "NOT_APPLICABLE"].sort(),
    );
  });

  it("runs deterministic structure lint without a second model", () => {
    const refs = ["S1"];
    const issues = runProductMapStructureLint({
      productMap: {
        rootName: "产品结构",
        modules: [
          {
            id: "M1",
            name: "核心模块",
            purpose: "完成目标",
            goalIds: ["G1"],
            evidenceStatus: "INFERRED",
            citations: refs,
            surfaces: [
              {
                stableId: "P1",
                name: "业务工作区",
                kind: "page",
                purpose: "完成核心任务",
                features: [
                  { featureId: "F1", actionIds: ["A1"], stateIds: ["ST1"] },
                ],
                evidenceStatus: "INFERRED",
                citations: refs,
              },
            ],
          },
        ],
      },
      pages: {
        pages: [
          {
            id: "P1",
            name: "业务工作区",
            purpose: "完成核心任务",
            userRoles: ["项目经理"],
            entry: "项目入口",
            coreContent: ["业务信息"],
            coreActions: ["确认"],
            states: ["success"],
            exceptionStates: ["error"],
            navigation: ["完成"],
            dependencies: [],
            priority: "Must",
            moduleId: "M1",
            goalIds: ["G1"],
            evidenceStatus: "INFERRED",
            citations: refs,
          },
        ],
      },
      features: {
        features: [
          {
            id: "F1",
            name: "确认业务信息",
            purpose: "完成确认",
            userRole: "项目经理",
            entry: "P1",
            action: "确认",
            result: "完成",
            states: ["success", "error"],
            dependencies: [],
            pageIds: ["P1"],
            moduleId: "M1",
            priority: "Must",
            evidenceStatus: "INFERRED",
            citations: refs,
          },
        ],
      },
      userPath: {
        steps: ["进入", "开始", "参与", "完成", "下一步"].map(
          (stage, index) => ({
            id: `J${index + 1}`,
            stage,
            userAction: stage,
            systemFeedback: "明确反馈",
            entryCondition: index ? `J${index}` : "已授权",
            exitCondition: index === 4 ? "结束" : `J${index + 2}`,
            pageIds: ["P1"],
            goalIds: ["G1"],
            confidence: "inferred",
            sourceRefs: refs,
          }),
        ),
        pathSummary: "进入到完成",
      },
    });
    assert.ok(issues.some((issue) => issue.issue === "page_states_incomplete"));
    assert.ok(
      !issues.some((issue) => issue.issue === "structure_schema_invalid"),
    );
  });

  it("binds the trusted Skill digest and keeps registry and migration provider-neutral", async () => {
    const [skill, migration] = await Promise.all([
      readFile(
        new URL("../skills/product-map/SKILL.md", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../drizzle/0033_product_map_skill.sql", import.meta.url),
        "utf8",
      ),
    ]);
    assert.equal(
      createHash("sha256").update(skill).digest("hex"),
      PRODUCT_MAP_SKILL_FILE_SHA256,
    );
    assert.deepEqual(
      productMapSkillRegistry.list().map((entry) => entry.id),
      ["product-map"],
    );
    assert.doesNotMatch(
      `${skill}\n${migration}`,
      /qwen|deepseek|dashscope|qwen-product-map-cn-v1|cn-beijing/iu,
    );
    assert.match(migration, /product_map_generation/u);
    assert.doesNotMatch(
      migration,
      /insert\s+into\s+"?ai_generation_models|insert\s+into\s+"?ai_providers/iu,
    );
  });

  it("keeps the workflow GET route read-only for viewer polling", async () => {
    const route = await readFile(
      new URL(
        "../app/api/projects/[projectId]/workflows/[runId]/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const getStart = route.indexOf("export async function GET");
    const patchStart = route.indexOf("export async function PATCH");
    assert.ok(getStart >= 0 && patchStart > getStart);
    const getHandler = route.slice(getStart, patchStart);
    assert.match(getHandler, /getProductMapRun/u);
    assert.doesNotMatch(getHandler, /scheduleProductMapRunInApp/u);
  });

  it("catalogs migration 0033 and keeps the Product Map browser suite on the CI path", async () => {
    const [journal, migration, focusedConfig, ci, focusedSpec] = await Promise.all([
      readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
      readFile(
        new URL("../drizzle/0033_product_map_skill.sql", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../playwright.focused-mvp.config.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
      readFile(new URL("./e2e/focused-mvp.spec.ts", import.meta.url), "utf8"),
    ]);

    assert.match(journal, /"tag": "0033_product_map_skill"/u);
    for (const table of [
      "product_map_runs",
      "product_map_sources",
      "product_map_executions",
      "product_map_artifacts",
      "product_map_artifact_versions",
    ]) {
      assert.match(migration, new RegExp(`CREATE TABLE "${table}"`, "u"));
    }
    assert.match(
      migration,
      /product_map_sources_run_project_fk[\s\S]*?REFERENCES "product_map_runs"\("id","project_id"\)/u,
    );
    assert.match(
      migration,
      /product_map_artifacts_published_version_fk[\s\S]*?REFERENCES "project_document_versions"\("id","document_id","project_id"\)/u,
    );
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "product_map_runs_idempotency_uidx"[\s\S]*?\("project_id","creator_id","idempotency_key_hash"\)/u,
    );
    assert.match(migration, /"reserved_tokens" integer NOT NULL/u);
    assert.match(
      migration,
      /product_map_executions_cost_check[\s\S]*?provider_not_reported/u,
    );
    assert.match(focusedConfig, /testMatch:\s*"focused-mvp\.spec\.ts"/u);
    assert.match(
      focusedSpec,
      /test\("知识库项目到会话问答与需求文档产物的唯一 Happy Path"/u,
    );
    assert.match(focusedSpec, /quick-action-product-map/u);
    assert.doesNotMatch(focusedSpec, /test\.skip\([^\n]*Product Map/u);
    assert.match(ci, /npm run test:product-map-contract/u);
    assert.match(ci, /npm run test:product-map-integration/u);
    assert.match(ci, /npm run test:focused:e2e/u);
  });

  it("keeps the long-browser quota override behind the dual test environment gate", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
    const originalUserLimit = process.env.PRODUCT_MAP_TEST_USER_DAILY_TOKEN_LIMIT;
    const originalProjectLimit = process.env.PRODUCT_MAP_TEST_PROJECT_DAILY_TOKEN_LIMIT;
    try {
      Reflect.set(process.env, "NODE_ENV", "test");
      process.env.NEXT_PUBLIC_APP_ENV = "test";
      process.env.PRODUCT_MAP_TEST_USER_DAILY_TOKEN_LIMIT = "5000000";
      process.env.PRODUCT_MAP_TEST_PROJECT_DAILY_TOKEN_LIMIT = "20000000";
      assert.equal(getProductMapAiLimits().userDailyTokens, 5_000_000);
      assert.equal(getProductMapAiLimits().projectDailyTokens, 20_000_000);

      Reflect.set(process.env, "NODE_ENV", "production");
      assert.deepEqual(getProductMapAiLimits(), PRODUCT_MAP_AI_LIMIT_DEFAULTS);
    } finally {
      if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
      else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
      if (originalAppEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
      else process.env.NEXT_PUBLIC_APP_ENV = originalAppEnv;
      if (originalUserLimit === undefined) delete process.env.PRODUCT_MAP_TEST_USER_DAILY_TOKEN_LIMIT;
      else process.env.PRODUCT_MAP_TEST_USER_DAILY_TOKEN_LIMIT = originalUserLimit;
      if (originalProjectLimit === undefined) delete process.env.PRODUCT_MAP_TEST_PROJECT_DAILY_TOKEN_LIMIT;
      else process.env.PRODUCT_MAP_TEST_PROJECT_DAILY_TOKEN_LIMIT = originalProjectLimit;
    }
  });
});
