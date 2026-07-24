import { z } from "zod";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import {
  requireApiPrincipal,
} from "@/lib/auth/session";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { getDb } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { knowledgeSpace } from "@/lib/db/schema";
import {
  createProjectWithManager,
  listAuthorizedProjects,
} from "@/lib/db/repositories/project-repository";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import {
  serializeAuthorizedProject,
} from "@/lib/projects/serialization";
import { resolveProjectCreationScope } from "@/lib/knowledge/product-v2";

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
    departmentId: z.string().min(1).max(200).nullable().optional(),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const projects = await listAuthorizedProjects(
      principal.user.id,
      principal.user.productRole,
    );
    return jsonResponse({
      projects: projects.map((project) =>
        serializeAuthorizedProject(project, principal)),
    });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const parsed = projectInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "请检查项目字段" } },
        { status: 400 },
      );
    }

    const context = getRequestAuditContext(request.headers);
    const createdProject = await getDb().transaction(async (tx) => {
      const scope = await resolveProjectCreationScope({
        principal,
        requestedDepartmentId: parsed.data.departmentId,
        db: tx,
      });
      const created = await createProjectWithManager(
        {
          id: `project-${crypto.randomUUID()}`,
          ...parsed.data,
          organizationId: scope.organizationId,
          departmentId: scope.departmentId,
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
    const [createdSpace] = await getDb()
      .select({ id: knowledgeSpace.id })
      .from(knowledgeSpace)
      .where(eq(knowledgeSpace.projectId, createdProject.id))
      .limit(1);
    if (!createdSpace) throw new Error("Created project is missing its knowledge space.");
    return jsonResponse(
      {
        project: serializeAuthorizedProject(
          { ...createdProject, projectRole: "project_manager" },
          principal,
        ),
        knowledgeSpaceId: createdSpace.id,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonResponse(
        { error: { code: "INVALID_JSON", message: "请求格式无效" } },
        { status: 400 },
      );
    }
    return knowledgeManagementErrorResponse(error);
  }
}
