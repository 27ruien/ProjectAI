import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { FileOperationError } from "@/lib/files/errors";
import { maxUploadBytes } from "@/lib/files/config";
import { fileRouteErrorResponse, idempotencyKeyFrom } from "@/lib/files/http";
import {
  companyCategories,
  listCompanyKnowledge,
  uploadCompanyKnowledge,
} from "@/lib/focused-mvp/company-knowledge";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";

const querySchema = z.object({
  category: z.enum(companyCategories).optional(),
  query: z.string().trim().max(200).optional(),
});

const uploadSchema = z.object({
  category: z.enum(companyCategories),
  audience: z.enum(["organization", "department", "admin"]),
  departmentId: z.string().min(1).max(200).nullable(),
  expiresAt: z.coerce.date().nullable(),
  displayName: z.string().trim().min(1).max(240).nullable(),
  versionNote: z.string().trim().max(500).nullable(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      category: url.searchParams.get("category") || undefined,
      query: url.searchParams.get("query") || undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "筛选条件无效" } }, { status: 400 });
    }
    return jsonResponse(await listCompanyKnowledge({ principal, ...parsed.data }));
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request, { allowedMediaTypes: ["multipart/form-data"] });
    const principal = await requireApiPrincipal(request.headers);
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > maxUploadBytes() + 1024 * 1024) {
      throw new FileOperationError(413, "FILE_TOO_LARGE", "文件超过上传大小限制");
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new FileOperationError(400, "INVALID_REQUEST", "请选择一个文件");
    const parsed = uploadSchema.safeParse({
      category: form.get("category"),
      audience: form.get("audience"),
      departmentId: form.get("departmentId") || null,
      expiresAt: form.get("expiresAt") || null,
      displayName: form.get("displayName") || null,
      versionNote: form.get("versionNote") || null,
    });
    if (!parsed.success) throw new FileOperationError(400, "INVALID_REQUEST", "公司资料信息无效");
    const result = await uploadCompanyKnowledge({
      principal,
      requestHeaders: request.headers,
      idempotencyKey: idempotencyKeyFrom(request),
      file,
      ...parsed.data,
    });
    return jsonResponse(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const knowledgeResponse = knowledgeManagementErrorResponse(error);
    if (knowledgeResponse.status !== 500) return knowledgeResponse;
    return fileRouteErrorResponse(error);
  }
}
