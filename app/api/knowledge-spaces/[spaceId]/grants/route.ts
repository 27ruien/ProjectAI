import { jsonResponse } from "@/lib/auth/http";

export async function POST(): Promise<Response> {
  return jsonResponse(
    { error: { code: "NOT_FOUND", message: "授权规则端点已停用，请使用空间成员权限" } },
    { status: 404 },
  );
}
