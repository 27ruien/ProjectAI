import { z } from "zod";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import {
  AuthorizationError,
  requireApiPrincipal,
} from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { getDb } from "@/lib/db/client";
import {
  createProjectWithManager,
  listAuthorizedProjects,
} from "@/lib/db/repositories/project-repository";
import {
  serializeAuthorizedProject,
  serializeProject,
} from "@/lib/projects/serialization";

const projectInputSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    clientName: z.string().trim().min(2).max(200),
    description: z.string().trim().max(4_000).default(""),
    status: z
      .enum(["planning", "active", "paused", "completed", "cancelled", "at_risk"])
      .default("planning"),
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
      .default("discovery"),
    health: z
      .enum(["healthy", "attention", "at_risk", "critical"])
      .default("healthy"),
    targetLaunchDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const projects = await listAuthorizedProjects(
      principal.user.id,
      principal.user.systemRole,
    );
    return jsonResponse({
      projects: projects.map(serializeAuthorizedProject),
    });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    if (principal.user.systemRole !== "system_admin") {
      throw new AuthorizationError(403, "FORBIDDEN", "无权创建项目");
    }
    const parsed = projectInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "请检查项目字段" } },
        { status: 400 },
      );
    }

    const context = getRequestAuditContext(request.headers);
    const createdProject = await getDb().transaction(async (tx) => {
      const created = await createProjectWithManager(
        {
          id: `project-${crypto.randomUUID()}`,
          ...parsed.data,
          targetLaunchDate: parsed.data.targetLaunchDate ?? null,
          createdBy: principal.user.id,
        },
        tx,
      );
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          projectId: created.id,
          eventType: "project_created",
          entityType: "project",
          entityId: created.id,
          result: "succeeded",
          ...context,
        },
        tx,
      );
      return created;
    });
    return jsonResponse(
      { project: serializeProject(createdProject) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonResponse(
        { error: { code: "INVALID_JSON", message: "请求格式无效" } },
        { status: 400 },
      );
    }
    return authorizationErrorResponse(error);
  }
}
