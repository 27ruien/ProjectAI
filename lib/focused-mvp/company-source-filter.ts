import { sql, type SQL } from "drizzle-orm";

/**
 * Organization-space documents are not AI-eligible merely because the
 * underlying object exists. They must have an explicit, currently published
 * company-knowledge record whose audience includes the actor and target
 * project. Project-space evidence keeps the existing project ACL contract.
 */
export function publishedCompanySourceFilter(input: {
  actorUserId: string;
  targetProjectId: string;
  sourceScope: SQL;
  documentId: SQL;
}): SQL {
  return sql`(
    ${input.sourceScope} <> 'organization'
    or exists (
      select 1
      from company_knowledge_documents company_source
      join projects company_target_project
        on company_target_project.id = ${input.targetProjectId}
      join users company_actor
        on company_actor.id = ${input.actorUserId}
        and company_actor.status = 'active'
      where company_source.document_id = ${input.documentId}
        and company_source.organization_id = company_target_project.organization_id
        and company_source.lifecycle_status = 'published'
        and (company_source.expires_at is null or company_source.expires_at > now())
        and (
          company_source.audience = 'organization'
          or company_actor.product_role in ('super_admin', 'admin')
          or (
            company_source.audience = 'department'
            and company_source.department_id = company_target_project.department_id
            and exists (
              select 1
              from department_members company_department_member
              where company_department_member.department_id = company_source.department_id
                and company_department_member.organization_id = company_source.organization_id
                and company_department_member.user_id = ${input.actorUserId}
                and company_department_member.is_active
            )
          )
        )
    )
  )`;
}
