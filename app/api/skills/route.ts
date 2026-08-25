import { handleOfficialSkillListRequest } from "@/lib/skills";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleOfficialSkillListRequest(request);
}
