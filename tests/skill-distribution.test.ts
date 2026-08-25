import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { AuthorizationError } from "../lib/auth/session";
import {
  handleOfficialSkillListRequest,
  handleOfficialSkillReadRequest,
  listOfficialSkills,
  loadOfficialSkill,
  type OfficialSkillApiDependencies,
} from "../lib/skills";

const authenticatedDependencies: OfficialSkillApiDependencies = {
  authorize: async () => ({ sessionId: "test-session" }),
  list: listOfficialSkills,
  read: loadOfficialSkill,
};

function request(path: string): Request {
  return new Request(`http://local.test${path}`, {
    headers: { accept: "application/json" },
  });
}

test("authenticated official Skill list returns repository metadata for four distributable Skills", async () => {
  const response = await handleOfficialSkillListRequest(
    request("/api/skills"),
    authenticatedDependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");

  const body = (await response.json()) as {
    source: string;
    skills: Array<Record<string, unknown>>;
  };
  assert.equal(body.source, "project_ai");
  assert.equal(body.skills.length, 4);
  assert.deepEqual(
    body.skills.map((skill) => [skill.id, skill.version, skill.status]),
    [
      ["project-weekly-report", "1.2.0", "active"],
      ["project-timeline-maker", "0.1.0", "experimental"],
      ["project-requirement-analyst", "0.2.1", "experimental"],
      ["project-feasibility-research", "0.1.0", "experimental"],
    ],
  );
  for (const skill of body.skills) {
    assert.equal(Object.hasOwn(skill, "skillMarkdown"), false);
  }
});

test("authenticated official Skill read returns the exact current SKILL.md only", async () => {
  const skillId = "project-requirement-analyst";
  const response = await handleOfficialSkillReadRequest(
    request(`/api/skills/${skillId}`),
    skillId,
    authenticatedDependencies,
  );
  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    source: string;
    skill: Record<string, unknown>;
  };
  const expected = await readFile(
    join(process.cwd(), "skills", skillId, "SKILL.md"),
    "utf8",
  );
  assert.equal(body.source, "project_ai");
  assert.equal(body.skill.skillMarkdown, expected);
  assert.equal(body.skill.id, skillId);
  assert.equal(body.skill.version, "0.2.1");
  assert.deepEqual(Object.keys(body.skill).sort(), [
    "category",
    "contentType",
    "description",
    "id",
    "name",
    "skillMarkdown",
    "status",
    "tags",
    "version",
  ]);
  assert.equal(Object.hasOwn(body.skill, "files"), false);
  assert.equal(Object.hasOwn(body.skill, "references"), false);
  assert.equal(Object.hasOwn(body.skill, "assets"), false);
  assert.equal(Object.hasOwn(body.skill, "projectId"), false);
  assert.equal(Object.hasOwn(body.skill, "documents"), false);
  assert.equal(Object.hasOwn(body.skill, "knowledge"), false);
});

test("official Skill API blocks unauthenticated list and read requests", async () => {
  const unauthenticated: OfficialSkillApiDependencies = {
    ...authenticatedDependencies,
    authorize: async () => {
      throw new AuthorizationError(401, "UNAUTHENTICATED", "请先登录");
    },
  };

  for (const response of [
    await handleOfficialSkillListRequest(request("/api/skills"), unauthenticated),
    await handleOfficialSkillReadRequest(
      request("/api/skills/project-weekly-report"),
      "project-weekly-report",
      unauthenticated,
    ),
  ]) {
    assert.equal(response.status, 401);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      "UNAUTHENTICATED",
    );
  }
});

test("official Skill read returns 404 for unknown and traversal-shaped IDs", async () => {
  for (const skillId of [
    "unknown-skill",
    "../PROJECT_AI_CURRENT_STATE.md",
    "project-weekly-report/references/schema.md",
    "%2e%2e%2fPROJECT_AI_CURRENT_STATE.md",
  ]) {
    const response = await handleOfficialSkillReadRequest(
      request(`/api/skills/${encodeURIComponent(skillId)}`),
      skillId,
      authenticatedDependencies,
    );
    assert.equal(response.status, 404, skillId);
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      "SKILL_NOT_FOUND",
      skillId,
    );
  }
});
