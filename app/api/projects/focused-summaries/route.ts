import { sql } from "drizzle-orm";
import { jsonResponse } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { listAuthorizedProjects } from "@/lib/db/repositories/project-repository";
import { authorizationErrorResponse } from "@/lib/auth/http";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const projects = await listAuthorizedProjects(principal.user.id, principal.user.productRole);
    if (!projects.length) return jsonResponse({ summaries: [] });
    const ids = projects.map((item) => item.id);
    const result = await getDb().execute<{
      project_id: string;
      department_name: string | null;
      file_count: number | string;
      requirement_count: number | string;
      current_requirement_version: number | string | null;
      latest_activity_at: Date | string;
    }>(sql`
      select p.id as project_id,
        dep.name as department_name,
        count(distinct d.id) filter (where ks.space_type = 'project' and d.document_status = 'active')::int as file_count,
        count(distinct r.id) filter (where r.status in ('draft', 'published'))::int as requirement_count,
        max(r.version_number) filter (where r.status in ('draft', 'published'))::int as current_requirement_version,
        greatest(p.updated_at, coalesce(max(d.updated_at), p.updated_at), coalesce(max(r.updated_at), p.updated_at)) as latest_activity_at
      from projects p
      left join departments dep on dep.id = p.department_id and dep.organization_id = p.organization_id
      left join project_documents d on d.project_id = p.id
      left join knowledge_spaces ks on ks.id = d.knowledge_space_id
      left join focused_requirement_documents r on r.project_id = p.id
      where p.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      group by p.id, dep.name
    `);
    return jsonResponse({ summaries: result.rows.map((row) => ({ projectId: row.project_id, departmentName: row.department_name, fileCount: Number(row.file_count), requirementCount: Number(row.requirement_count), currentRequirementVersion: row.current_requirement_version === null ? null : Number(row.current_requirement_version), latestActivityAt: new Date(row.latest_activity_at).toISOString() })) });
  } catch (error) {
    return authorizationErrorResponse(error);
  }
}
