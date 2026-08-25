import { authorizationErrorResponse, jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  listOfficialSkills,
  loadOfficialSkill,
  OfficialSkillCatalogError,
  type OfficialSkillAsset,
  type OfficialSkillMetadata,
} from "./catalog";

export type OfficialSkillApiDependencies = {
  authorize: (headers: Headers) => Promise<unknown>;
  list: () => Promise<OfficialSkillMetadata[]>;
  read: (skillId: string) => Promise<OfficialSkillAsset>;
};

const defaultDependencies: OfficialSkillApiDependencies = {
  authorize: requireApiPrincipal,
  list: listOfficialSkills,
  read: loadOfficialSkill,
};

function errorResponse(error: unknown): Response {
  if (error instanceof OfficialSkillCatalogError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  return authorizationErrorResponse(error);
}

export async function handleOfficialSkillListRequest(
  request: Request,
  dependencies: OfficialSkillApiDependencies = defaultDependencies,
): Promise<Response> {
  try {
    await dependencies.authorize(request.headers);
    return jsonResponse({
      schemaVersion: "project-ai-official-skills-v1",
      source: "project_ai",
      skills: await dependencies.list(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleOfficialSkillReadRequest(
  request: Request,
  skillId: string,
  dependencies: OfficialSkillApiDependencies = defaultDependencies,
): Promise<Response> {
  try {
    await dependencies.authorize(request.headers);
    return jsonResponse({
      schemaVersion: "project-ai-official-skill-v1",
      source: "project_ai",
      skill: await dependencies.read(skillId),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
