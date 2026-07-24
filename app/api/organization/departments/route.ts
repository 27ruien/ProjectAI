import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import {
  createOrganizationDepartment,
  getOrganizationTree,
  updateOrganizationDepartment,
} from "@/lib/organization/service";

const createSchema = z.object({
  parentDepartmentId: z.string().min(1).max(200).nullable(),
  name: z.string().trim().min(2).max(200),
  code: z.string().trim().min(2).max(80).regex(/^[A-Z0-9-]+$/),
  headUserIds: z.array(z.string().min(1).max(200)).max(20).default([]),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
}).strict();

const updateSchema = z.object({
  departmentId: z.string().min(1).max(200),
  parentDepartmentId: z.string().min(1).max(200).nullable().optional(),
  name: z.string().trim().min(2).max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  headUserIds: z.array(z.string().min(1).max(200)).max(20).optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "departmentId"), {
  message: "No changes supplied",
});

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(await getOrganizationTree(principal));
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "部门信息无效" } }, { status: 400 });
    }
    return jsonResponse({
      department: await createOrganizationDepartment({
        principal,
        ...parsed.data,
        requestHeaders: request.headers,
      }),
    }, { status: 201 });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "部门变更无效" } }, { status: 400 });
    }
    return jsonResponse({
      department: await updateOrganizationDepartment({
        principal,
        ...parsed.data,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
