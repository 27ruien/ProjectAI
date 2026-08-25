import { handleOfficialSkillReadRequest } from "@/lib/skills";

export const runtime = "nodejs";

type SkillRouteContext = { params: Promise<{ skillId: string }> };

export async function GET(
  request: Request,
  context: SkillRouteContext,
): Promise<Response> {
  const { skillId } = await context.params;
  return handleOfficialSkillReadRequest(request, skillId);
}
