import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRequirementChecklist,
  parseTimelineMakerMarkdown,
  parseTimelineMakerMarkdownToWorkbench,
  renderTimelineMakerMarkdown,
  requirementGapTasks,
  timelineMakerCapabilityRequestSchema,
  timelineMakerDraftSchema,
  timelineMakerDraftToWorkbenchData,
  type TimelineMakerDraft,
  type TimelineMakerFeature,
} from "@/lib/timeline-maker";

function features(...values: TimelineMakerFeature[]): ReadonlySet<TimelineMakerFeature> {
  return new Set(values);
}

function draft(overrides: Partial<TimelineMakerDraft> = {}): TimelineMakerDraft {
  return {
    schemaVersion: "projectai-timeline-maker-draft-v1",
    skillId: "project-timeline-maker",
    skillVersion: "0.1.0",
    title: "Synthetic Project Timeline",
    mode: "create_draft",
    existingTimelineVersion: null,
    language: "zh",
    requirements: [],
    phases: [{
      name: "Planning",
      basis: "confirmed",
      basisDetail: "Project brief explicitly names the Planning phase",
    }],
    tasks: [{
      id: "task-planning",
      stage: "Planning",
      name: "Confirm scope",
      owners: [],
      status: "incomplete",
      start: "2026-09-01",
      end: "2026-09-03",
      basis: "confirmed",
      basisDetail: "Project brief supplies the task and exact dates",
      requirementIds: [],
      assumptionId: null,
    }],
    assumptions: [],
    warnings: [],
    ...overrides,
  };
}

test("TM-01 Basic Project preserves explicit phases, tasks, dates, and Workbench fields", () => {
  const input = draft({
    tasks: [{
      id: "task-design",
      stage: "Planning",
      name: "Complete design review",
      owners: ["Confirmed Owner"],
      status: "incomplete",
      start: "2026-09-01",
      end: "2026-09-05",
      basis: "confirmed",
      basisDetail: "The supplied plan explicitly provides task, owner, and dates",
      requirementIds: [],
      assumptionId: null,
    }],
  });
  const parsed = timelineMakerDraftSchema.parse(input);
  const workbench = timelineMakerDraftToWorkbenchData(parsed);
  assert.deepEqual(workbench.tasks[0], {
    id: "task-design",
    stage: "Planning",
    name: "Complete design review",
    owners: ["Confirmed Owner"],
    status: "incomplete",
    start: "2026-09-01",
    end: "2026-09-05",
  });
  const markdown = renderTimelineMakerMarkdown(parsed);
  assert.deepEqual(parseTimelineMakerMarkdown(markdown), parsed);
  assert.deepEqual(parseTimelineMakerMarkdownToWorkbench(markdown), workbench);
});

test("TM-02 Campaign marks absent Activity Rules as MISSING without inventing rules", () => {
  const requirements = buildRequirementChecklist({
    features: features("campaign_event"),
    suppliedEvidence: { "activity-dates": "Campaign runs 2026-09-10 to 2026-09-20" },
  });
  const activityRules = requirements.find((item) => item.id === "activity-rules");
  assert.equal(activityRules?.status, "MISSING");
  assert.equal(activityRules?.evidence, null);
  assert.equal(requirements.find((item) => item.id === "activity-dates")?.status, "CONFIRMED");
  const tasks = requirementGapTasks({ requirements, stage: "Project Readiness" });
  const gap = tasks.find((item) => item.requirementIds.includes("activity-rules"));
  assert.equal(gap?.basis, "requirement_gap");
  assert.deepEqual(gap?.owners, []);
  assert.equal(gap?.start, "");
  assert.doesNotMatch(JSON.stringify({ requirements, tasks }), /每人每日三次|中奖概率|满100减20/u);
});

test("TM-03 Visual Design identifies missing Brand Guideline, Logo, and Fonts", () => {
  const requirements = buildRequirementChecklist({ features: features("visual_design") });
  for (const id of ["brand-guideline", "logo-assets", "font-assets"]) {
    assert.equal(requirements.find((item) => item.id === id)?.status, "MISSING");
  }
});

test("TM-04 Personal Data triggers Privacy and Consent checks without legal conclusions", () => {
  const requirements = buildRequirementChecklist({
    features: features("personal_information"),
    suppliedEvidence: { "personal-data-fields": "手机号、Email" },
  });
  assert.equal(requirements.find((item) => item.id === "personal-data-fields")?.status, "CONFIRMED");
  assert.equal(requirements.find((item) => item.id === "privacy-policy")?.status, "MISSING");
  assert.equal(requirements.find((item) => item.id === "personal-data-consent")?.status, "MISSING");
  assert.doesNotMatch(JSON.stringify(requirements), /合法合规|满足GDPR|保存30天/u);
});

test("TM-05 Photo and Face triggers sensitive-data requirements with allowed statuses", () => {
  const requirements = buildRequirementChecklist({
    features: features("photo_face_biometric"),
    unclearRequirementIds: new Set(["processing-provider-location"]),
  });
  for (const id of [
    "biometric-consent",
    "sensitive-information-handling",
    "photo-retention-deletion",
    "photo-user-notice",
  ]) {
    assert.equal(requirements.find((item) => item.id === id)?.status, "MISSING");
  }
  assert.equal(
    requirements.find((item) => item.id === "processing-provider-location")?.status,
    "UNCLEAR",
  );
});

test("TM-06 Third-party Integration exposes API Docs and Test Environment gaps", () => {
  const requirements = buildRequirementChecklist({
    features: features("development", "third_party_integration"),
    suppliedEvidence: { "development-scope": "Frontend account binding flow" },
  });
  assert.equal(requirements.find((item) => item.id === "development-scope")?.status, "CONFIRMED");
  assert.equal(requirements.find((item) => item.id === "api-documentation")?.status, "MISSING");
  assert.equal(requirements.find((item) => item.id === "test-environment")?.status, "MISSING");
  assert.ok(requirementGapTasks({ requirements, stage: "Integration Readiness" })
    .some((task) => task.requirementIds.includes("api-documentation")));
});

test("TM-07 Confirmed Launch date stays fixed while inferred dates remain assumptions", () => {
  const requirements = buildRequirementChecklist({
    features: features("launch"),
    suppliedEvidence: { "release-date": "Launch = 2026-09-30" },
  });
  const input = draft({
    requirements,
    phases: [
      { name: "Design", basis: "inferred", basisDetail: "Planning assumption for an undated phase" },
      { name: "Launch", basis: "confirmed", basisDetail: "User explicitly supplied Launch = 2026-09-30" },
    ],
    tasks: [
      {
        id: "task-design-assumed",
        stage: "Design",
        name: "Prepare design draft",
        owners: [],
        status: "incomplete",
        start: "2026-09-01",
        end: "2026-09-05",
        basis: "inferred",
        basisDetail: "Assumed five-day design window",
        requirementIds: [],
        assumptionId: "assumption-design-window",
      },
      {
        id: "task-launch-confirmed",
        stage: "Launch",
        name: "Launch",
        owners: [],
        status: "incomplete",
        start: "2026-09-30",
        end: "2026-09-30",
        basis: "confirmed",
        basisDetail: "User explicitly supplied Launch = 2026-09-30",
        requirementIds: ["release-date"],
        assumptionId: null,
      },
    ],
    assumptions: [{
      id: "assumption-design-window",
      statement: "Design uses a five-working-day planning assumption",
      affectedTaskIds: ["task-design-assumed"],
    }],
  });
  const parsed = timelineMakerDraftSchema.parse(input);
  assert.equal(parsed.tasks.find((item) => item.id === "task-launch-confirmed")?.end, "2026-09-30");
  assert.equal(parsed.tasks.find((item) => item.id === "task-design-assumed")?.basis, "inferred");
  assert.deepEqual(parseTimelineMakerMarkdown(renderTimelineMakerMarkdown(parsed)), parsed);
});

test("TM-08 Existing Timeline requires a version-bound proposal and cannot use create capability", () => {
  const proposal = draft({
    mode: "propose_update",
    existingTimelineVersion: 3,
    warnings: ["Proposed changes require user review before apply"],
  });
  const accepted = timelineMakerCapabilityRequestSchema.parse({
    capability: "propose_timeline_update",
    projectId: "project-a",
    expectedTimelineVersion: 3,
    draft: proposal,
  });
  assert.equal(accepted.capability, "propose_timeline_update");
  assert.equal(
    timelineMakerCapabilityRequestSchema.safeParse({
      capability: "create_timeline_draft",
      projectId: "project-a",
      expectedTimelineVersion: null,
      draft: proposal,
    }).success,
    false,
  );
  assert.deepEqual(
    parseTimelineMakerMarkdown(renderTimelineMakerMarkdown(proposal)),
    proposal,
  );
});

test("Timeline Maker Markdown parser rejects prose, code fences, and invalid Workbench values", () => {
  const markdown = renderTimelineMakerMarkdown(draft());
  assert.throws(() => parseTimelineMakerMarkdown("说明\n" + markdown));
  assert.throws(() => parseTimelineMakerMarkdown("```md\n" + markdown + "```"));
  assert.throws(() => parseTimelineMakerMarkdown(markdown.replace("2026-09-01", "2026/09/01")));
  assert.throws(() => parseTimelineMakerMarkdown(markdown.replace("incomplete", "planned")));
});

test("Timeline Maker Draft rejects untraceable assumptions and requirement gaps", () => {
  const inferred = draft();
  inferred.tasks[0] = {
    ...inferred.tasks[0],
    basis: "inferred",
    assumptionId: null,
  };
  assert.equal(timelineMakerDraftSchema.safeParse(inferred).success, false);

  const gap = draft();
  gap.tasks[0] = {
    ...gap.tasks[0],
    basis: "requirement_gap",
    requirementIds: [],
  };
  assert.equal(timelineMakerDraftSchema.safeParse(gap).success, false);

  const unsupportedNotApplicable = buildRequirementChecklist({
    features: features("campaign_event"),
    notApplicableRequirementIds: new Set(["activity-rules"]),
  });
  assert.equal(
    unsupportedNotApplicable.find((item) => item.id === "activity-rules")?.status,
    "UNCLEAR",
  );

  const oneWayAssumption = draft({
    assumptions: [{
      id: "assumption-unlinked",
      statement: "Synthetic planning assumption",
      affectedTaskIds: [],
    }],
  });
  oneWayAssumption.tasks[0] = {
    ...oneWayAssumption.tasks[0],
    basis: "inferred",
    assumptionId: "assumption-unlinked",
  };
  assert.equal(timelineMakerDraftSchema.safeParse(oneWayAssumption).success, false);
});
