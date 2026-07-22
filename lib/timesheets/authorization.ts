import { and, eq } from "drizzle-orm";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { organization, organizationMember } from "@/lib/db/schema";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { TimesheetError } from "./errors";

export async function requireTimesheetOrganization(
  principal: AuthenticatedPrincipal,
  organizationId: string,
  requestHeaders?: Headers,
  db: DatabaseExecutor = getDb(),
): Promise<void> {
  const [membership] = await db
    .select({ id: organizationMember.id })
    .from(organizationMember)
    .innerJoin(
      organization,
      and(
        eq(organization.id, organizationMember.organizationId),
        eq(organization.isActive, true),
      ),
    )
    .where(
      and(
        eq(organizationMember.organizationId, organizationId),
        eq(organizationMember.userId, principal.user.id),
        eq(organizationMember.isActive, true),
      ),
    )
    .limit(1);
  if (membership) return;

  const context = requestHeaders
    ? getRequestAuditContext(requestHeaders)
    : { ipAddress: null, userAgent: null };
  await writeAuditEvent(
    {
      actorUserId: principal.user.id,
      eventType: "timesheet_access_denied",
      entityType: "organization",
      entityId: organizationId,
      result: "denied",
      metadata: { reason: "not_authorized_or_not_found" },
      ...context,
    },
    db,
  );
  throw new TimesheetError(404, "NOT_FOUND", "工作日报不存在");
}
