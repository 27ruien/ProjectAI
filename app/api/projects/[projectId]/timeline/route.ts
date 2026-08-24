import {
  authorizationErrorResponse,
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import { requireApiPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  findProjectTimelineSnapshot,
  saveProjectTimelineSnapshot,
  TimelineVersionConflictError,
} from "@/lib/db/repositories/project-timeline-repository";
import { saveProjectTimelineInputSchema } from "@/lib/timeline/persistence";

type TimelineRouteContext = { params: Promise<{ projectId: string }> };

function serializeTimeline(
  record: NonNullable<Awaited<ReturnType<typeof findProjectTimelineSnapshot>>>,
) {
  return {
    projectId: record.projectId,
    name: record.name,
    data: record.dataJson,
    version: record.version,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function GET(
  request: Request,
  context: TimelineRouteContext,
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const timeline = await findProjectTimelineSnapshot(projectId);
    return jsonResponse({ timeline: timeline ? serializeTimeline(timeline) : null });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  context: TimelineRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    await requireProjectAccess(principal, projectId, request.headers);
    const parsed = saveProjectTimelineInputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: "INVALID_INPUT", message: "请检查排期字段" } },
        { status: 400 },
      );
    }
    const record = await getDb().transaction(async (tx) => {
      await requireProjectRole(
        principal,
        projectId,
        ["project_manager", "project_member"],
        request.headers,
        { db: tx, lockForUpdate: true },
      );
      const saved = await saveProjectTimelineSnapshot(
        {
          projectId,
          actorUserId: principal.user.id,
          ...parsed.data,
        },
        tx,
      );
      await writeAuditEvent(
        {
          actorUserId: principal.user.id,
          projectId,
          eventType: "project_timeline_saved",
          entityType: "project_timeline",
          entityId: saved.id,
          result: "succeeded",
          metadata: {
            version: saved.version,
            taskCount: parsed.data.data.tasks.length,
          },
          ...getRequestAuditContext(request.headers),
        },
        tx,
      );
      return saved;
    });
    return jsonResponse({ timeline: serializeTimeline(record) });
  } catch (error) {
    if (error instanceof TimelineVersionConflictError) {
      return jsonResponse(
        {
          error: {
            code: "TIMELINE_VERSION_CONFLICT",
            message: "排期已被其他更新修改，请重新加载后再保存",
            currentVersion: error.currentVersion,
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
