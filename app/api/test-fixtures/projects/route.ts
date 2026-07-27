import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { knowledgeSpace, organization, project } from "@/lib/db/schema";
import { KnowledgeManagementError } from "@/lib/knowledge/errors";
import { knowledgeManagementErrorResponse } from "@/lib/knowledge/http";
import {
  fixtureContextFromHeaders,
  registerTestFixture,
} from "@/lib/test-fixtures/service";

const inputSchema = z
  .object({ projectId: z.string().min(1).max(200) })
  .strict();

const reviewedSyntheticProjectName = /^(?:Member Creator UAT [a-f0-9]{8}(?: 已更新)?|Product V2 ACL UAT [a-f0-9]{8}|需求结果空间 [a-f0-9]{8})$/iu;

export async function POST(request: Request): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const principal = await requireApiPrincipal(request.headers);
    const fixture = fixtureContextFromHeaders(request.headers);
    const parsed = inputSchema.safeParse(await request.json());
    if (
      principal.user.productRole !== "super_admin" ||
      !fixture ||
      !parsed.success
    ) {
      throw new KnowledgeManagementError(
        404,
        "RESOURCE_NOT_FOUND",
        "页面不存在",
      );
    }

    const registered = await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({
          projectId: project.id,
          projectName: project.name,
          knowledgeSpaceId: knowledgeSpace.id,
        })
        .from(project)
        .innerJoin(
          organization,
          eq(organization.id, project.organizationId),
        )
        .leftJoin(knowledgeSpace, eq(knowledgeSpace.projectId, project.id))
        .where(
          and(
            eq(project.id, parsed.data.projectId),
            eq(organization.slug, "kivisense"),
            gt(project.createdAt, sql`now() - interval '7 days'`),
          ),
        );
      const projectRow = rows[0];
      if (
        !projectRow ||
        !reviewedSyntheticProjectName.test(projectRow.projectName)
      ) {
        throw new KnowledgeManagementError(
          404,
          "RESOURCE_NOT_FOUND",
          "页面不存在",
        );
      }
      const knowledgeSpaceIds = [
        ...new Set(
          rows
            .map((row) => row.knowledgeSpaceId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (knowledgeSpaceIds.length === 0) {
        throw new KnowledgeManagementError(
          404,
          "RESOURCE_NOT_FOUND",
          "页面不存在",
        );
      }
      await registerTestFixture(
        {
          ...fixture,
          entityType: "project",
          entityId: projectRow.projectId,
        },
        tx,
      );
      for (const knowledgeSpaceId of knowledgeSpaceIds) {
        await registerTestFixture(
          {
            ...fixture,
            entityType: "knowledge_space",
            entityId: knowledgeSpaceId,
          },
          tx,
        );
      }
      return { project: 1, knowledgeSpaces: knowledgeSpaceIds.length };
    });

    return jsonResponse({ registered });
  } catch (error) {
    return knowledgeManagementErrorResponse(error);
  }
}
