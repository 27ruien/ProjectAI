import { z } from "zod";
import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import {
  requireProjectAccess,
  requireProjectRole,
} from "@/lib/auth/authorization";
import { AuthorizationError, requireApiPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getPostgresErrorCode } from "@/lib/db/errors";
import { updateProject } from "@/lib/db/repositories/project-repository";
import { serializeAuthorizedProject } from "@/lib/projects/serialization";
import { department } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

type ProjectRouteContext = { params: Promise<{ projectId: string }> };

const projectPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    clientName: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(4_000).optional(),
    status: z
      .enum(["planning", "active", "paused", "completed", "cancelled", "at_risk"])
      .optional(),
    stage: z
      .enum([
        "discovery",
        "planning",
        "design",
        "development",
        "testing",
        "launch",
        "operation",
      ])
      .optional(),
    health: z.enum(["healthy", "attention", "at_risk", "critical"]).optional(),
    targetLaunchDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    departmentId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export async function GET(
  request: Request,
  context: ProjectRouteContext,
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const authorizedProject = await requireProjectAccess(
      principal,
      projectId,
      request.headers,
    );
    return jsonResponse({
      project: serializeAuthorizedProject(authorizedProject, principal),
    });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  context: ProjectRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    // Authenticate the URL resource before validating mutable fields so an
    // inaccessible project has the same 404 contract for valid and tampered
    // request bodies.
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = projectPatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "请检查项目字段" } },
        { status: 400 },
      );
    }
    const result = await getDb().transaction(async (tx) => {
      let authorizedProject;
      try {
        authorizedProject = await requireProjectRole(
          principal,
          projectId,
          parsed.data.departmentId !== undefined
            ? ["project_manager"]
            : ["project_manager", "project_member"],
          request.headers,
          { db: tx, lockForUpdate: true },
        );
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return { kind: "authorization_error", error } as const;
        }
        throw error;
      }

      if (parsed.data.departmentId) {
        const [validDepartment] = await tx
          .select({ id: department.id })
          .from(department)
          .where(
            and(
              eq(department.id, parsed.data.departmentId),
              eq(department.organizationId, authorizedProject.organizationId),
              eq(department.isActive, true),
            ),
          )
          .limit(1);
        if (!validDepartment) return { kind: "invalid_input" } as const;
      }

      const updated = await updateProject(projectId, parsed.data, tx);
      return updated
        ? ({
            kind: "updated",
            project: {
              ...updated,
              projectRole: authorizedProject.projectRole,
            },
          } as const)
        : ({ kind: "not_found" } as const);
    });

    if (result.kind === "authorization_error") throw result.error;
    if (result.kind === "invalid_input") {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "请检查项目字段" } },
        { status: 400 },
      );
    }
    if (result.kind === "not_found") {
      return jsonResponse(
        { error: { code: "NOT_FOUND", message: "项目不存在" } },
        { status: 404 },
      );
    }
    return jsonResponse({
      project: serializeAuthorizedProject(result.project, principal),
    });
  } catch (error) {
    if (getPostgresErrorCode(error) === "23514") {
      return jsonResponse(
        {
          error: {
            code: "PROJECT_DEPARTMENT_SCOPE_CONFLICT",
            message: "请先移除与新部门范围冲突的知识来源",
          },
        },
        { status: 409 },
      );
    }
    if (error instanceof SyntaxError) {
      return jsonResponse(
        { error: { code: "INVALID_JSON", message: "请求格式无效" } },
        { status: 400 },
      );
    }
    return authorizationErrorResponse(error);
  }
}
