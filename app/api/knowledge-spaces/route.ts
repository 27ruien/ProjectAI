import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import { listProductKnowledgeSpaces } from "@/lib/knowledge/product-v2";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(await listProductKnowledgeSpaces(principal));
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function POST(): Promise<Response> {
  return jsonResponse(
    { error: { code: "NOT_FOUND", message: "知识空间只能通过部门或项目生命周期创建" } },
    { status: 404 },
  );
}
