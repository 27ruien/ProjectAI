import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

async function apply(client: Client, filename: string): Promise<void> {
  const contents = await readFile(path.resolve("drizzle", filename), "utf8");
  for (const statement of contents.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) throw new Error("DATABASE_URL is required.");
  const base = new URL(raw);
  const databaseName = `projectai_product_v2_upgrade_${process.pid}_${Date.now()}`;
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  let target: Client | undefined;
  try {
    await admin.query(`create database "${databaseName}"`);
    const targetUrl = new URL(base);
    targetUrl.pathname = `/${databaseName}`;
    target = new Client({ connectionString: targetUrl.toString() });
    await target.connect();
    for (let index = 0; index <= 7; index += 1) {
      const prefix = index.toString().padStart(4, "0");
      const filename = readdir(path.resolve("drizzle"))
        .then((items) => items.find((item) => item.startsWith(`${prefix}_`) && item.endsWith(".sql")));
      const resolved = await filename;
      if (!resolved) throw new Error(`Missing migration ${prefix}`);
      await apply(target, resolved);
    }
    await target.query(`
      insert into users (id, email, display_name, system_role)
      values ('v2-legacy-super', 'v2-super@test.projectai.local', 'Legacy Super', 'system_admin');
      insert into accounts (id, account_id, provider_id, user_id, password_hash)
      values ('v2-legacy-credential', 'v2-super@test.projectai.local', 'credential', 'v2-legacy-super', 'retired-test-hash');
      insert into sessions (id, token, user_id, expires_at)
      values ('v2-legacy-session', 'retired-test-session', 'v2-legacy-super', now() + interval '1 hour');
    `);
    for (let index = 8; index <= 19; index += 1) {
      const prefix = index.toString().padStart(4, "0");
      const filename = readdir(path.resolve("drizzle"))
        .then((items) => items.find((item) => item.startsWith(`${prefix}_`) && item.endsWith(".sql")));
      const resolved = await filename;
      if (!resolved) throw new Error(`Missing migration ${prefix}`);
      await apply(target, resolved);
    }
    await target.query(`
      insert into users (id, email, display_name, system_role)
      values
        ('v2-legacy-admin', 'v2-admin@projectai.invalid', 'Legacy Admin', 'standard_user'),
        ('v2-legacy-member', 'v2-member@projectai.invalid', 'Legacy Member', 'standard_user');
      insert into organization_members (id, organization_id, user_id, role, created_by)
      values
        ('v2-org-admin', 'org-legacy-default', 'v2-legacy-admin', 'organization_admin', 'v2-legacy-super'),
        ('v2-org-member', 'org-legacy-default', 'v2-legacy-member', 'organization_member', 'v2-legacy-super')
      on conflict (organization_id, user_id) do nothing;
      insert into knowledge_spaces (
        id, organization_id, department_id, space_type, visibility,
        name, description, created_by
      ) values (
        'v2-legacy-space', 'org-legacy-default', 'dept-legacy-default',
        'department', 'department_shared', 'Legacy Product Space', '',
        'v2-legacy-super'
      );
      insert into knowledge_space_members (id, knowledge_space_id, user_id, role, created_by)
      values ('v2-space-member', 'v2-legacy-space', 'v2-legacy-member', 'editor', 'v2-legacy-super');
      insert into departments (id, organization_id, name, code, created_by)
      values ('v2-empty-department', 'org-legacy-default', 'Empty Legacy Department', 'V2-EMPTY', 'v2-legacy-super');
    `);
    await apply(target, "0020_natural_darkstar.sql");
    await apply(target, "0021_married_kree.sql");
    await apply(target, "0022_daily_piledriver.sql");
    await apply(target, "0023_retire_test_credentials.sql");
    await apply(target, "0024_restore_authorization_deny_priority.sql");
    const result = await target.query<{
      mapped_roles: string;
      mapped_access: string;
      organization_name: string;
      product_role_column: string | null;
      parent_column: string | null;
      temporary_column: string | null;
      member_updated_column: string | null;
      authorization_function: string | null;
      default_space_count: string;
      retired_credential_count: string;
      retired_session_count: string;
    }>(`
      select
        (select string_agg(product_role::text, ',' order by id)
          from users where id like 'v2-legacy-%') as mapped_roles,
        (select access_level::text from knowledge_space_members where id = 'v2-space-member') as mapped_access,
        (select name from organizations where id = 'org-legacy-default') as organization_name,
        (select column_name from information_schema.columns where table_name = 'users' and column_name = 'product_role') as product_role_column,
        (select column_name from information_schema.columns where table_name = 'departments' and column_name = 'parent_department_id') as parent_column,
        (select column_name from information_schema.columns where table_name = 'project_documents' and column_name = 'workflow_temporary') as temporary_column,
        (select column_name from information_schema.columns where table_name = 'knowledge_space_members' and column_name = 'updated_at') as member_updated_column,
        to_regprocedure('projectai_authorized_documents(text,text,knowledge_permission)')::text as authorization_function,
        (select count(*)::text from knowledge_spaces
          where id = 'ks-department-v2-empty-department'
            and department_id = 'v2-empty-department'
            and space_type = 'department'
            and visibility = 'department_shared') as default_space_count,
        (select count(*)::text from accounts where id = 'v2-legacy-credential') as retired_credential_count,
        (select count(*)::text from sessions where id = 'v2-legacy-session') as retired_session_count
    `);
    const row = result.rows[0];
    if (
      row.mapped_roles !== "admin,member,super_admin" ||
      row.mapped_access !== "edit" ||
      row.organization_name !== "Kivisense" ||
      row.product_role_column !== "product_role" ||
      row.parent_column !== "parent_department_id" ||
      row.temporary_column !== "workflow_temporary" ||
      row.member_updated_column !== "updated_at" ||
      row.default_space_count !== "1" ||
      row.retired_credential_count !== "0" ||
      row.retired_session_count !== "0" ||
      !row.authorization_function
    ) {
      throw new Error(`Product V2 migration contract failed: ${JSON.stringify(row)}`);
    }
    await target.query(`
      insert into users (id, email, display_name, product_role)
      values ('v2-outsider', 'v2-outsider@projectai.invalid', 'Legacy Outsider', 'member');
      insert into organization_members (id, organization_id, user_id, role, created_by)
      values ('v2-org-outsider', 'org-legacy-default', 'v2-outsider', 'organization_member', 'v2-legacy-super');
      insert into department_members (id, organization_id, department_id, user_id, role, created_by)
      values ('v2-dept-member', 'org-legacy-default', 'dept-legacy-default', 'v2-legacy-member', 'department_member', 'v2-legacy-super');
      insert into projects (id, organization_id, department_id, name, client_name, created_by)
      values ('v2-project', 'org-legacy-default', 'dept-legacy-default', 'V2 Project', 'Kivisense Internal', 'v2-legacy-super');
      insert into project_members (id, project_id, user_id, role, created_by)
      values
        ('v2-project-member', 'v2-project', 'v2-legacy-member', 'project_manager', 'v2-legacy-super'),
        ('v2-project-outsider', 'v2-project', 'v2-outsider', 'viewer', 'v2-legacy-super');
      insert into knowledge_space_members (
        id, knowledge_space_id, user_id, role, access_level, created_by
      )
      select 'v2-project-space-member', id, 'v2-legacy-member', 'editor', 'edit', 'v2-legacy-super'
      from knowledge_spaces where project_id = 'v2-project';
      insert into knowledge_space_members (
        id, knowledge_space_id, user_id, role, access_level, created_by
      )
      select 'v2-project-space-outsider', id, 'v2-outsider', 'viewer', 'view', 'v2-legacy-super'
      from knowledge_spaces where project_id = 'v2-project';
      insert into project_documents (
        id, project_id, knowledge_space_id, visibility, display_name,
        workflow_temporary, temporary_workflow_id, temporary_expires_at,
        document_status, created_by
      ) values
        ('v2-department-document', 'v2-project', 'v2-legacy-space', 'department_shared', 'Department Document', false, null, null, 'active', 'v2-legacy-super'),
        ('v2-project-document', 'v2-project', (select id from knowledge_spaces where project_id = 'v2-project'), 'private', 'Project Document', false, null, null, 'active', 'v2-legacy-super'),
        ('v2-temporary-document', 'v2-project', (select id from knowledge_spaces where project_id = 'v2-project'), 'private', 'Temporary Document', true, '12345678-1234-1234-1234-123456789abc', now() + interval '1 hour', 'active', 'v2-legacy-member');
    `);
    const authorization = await target.query<{
      admin_view: string;
      member_view: string;
      outsider_view: string;
      outsider_download: string;
      outsider_upload: string;
      outsider_temp: string;
    }>(`
      select
        (select count(*)::text from projectai_authorized_documents('v2-legacy-admin', 'v2-project', 'view')) as admin_view,
        (select count(*)::text from projectai_authorized_documents('v2-legacy-member', 'v2-project', 'view')) as member_view,
        (select count(*)::text from projectai_authorized_documents('v2-outsider', 'v2-project', 'view')) as outsider_view,
        (select count(*)::text from projectai_authorized_documents('v2-outsider', 'v2-project', 'download')) as outsider_download,
        (select count(*)::text from projectai_authorized_documents('v2-outsider', 'v2-project', 'upload')) as outsider_upload,
        (select count(*)::text from projectai_authorized_documents('v2-outsider', 'v2-project', 'view') where document_id = 'v2-temporary-document') as outsider_temp
    `);
    const authorizationRow = authorization.rows[0];
    if (
      authorizationRow.admin_view !== "3" ||
      authorizationRow.member_view !== "3" ||
      authorizationRow.outsider_view !== "1" ||
      authorizationRow.outsider_download !== "1" ||
      authorizationRow.outsider_upload !== "0" ||
      authorizationRow.outsider_temp !== "0"
    ) {
      throw new Error(`Product V2 authorization contract failed: ${JSON.stringify(authorizationRow)}`);
    }
    await target.query(`
      insert into document_grants (
        id, organization_id, project_id, document_id, subject_type,
        subject_id, permission, effect, created_by
      ) values (
        'v2-admin-document-deny', 'org-legacy-default', 'v2-project',
        'v2-project-document', 'user', 'v2-legacy-admin', 'view', 'deny',
        'v2-legacy-super'
      );
    `);
    const deniedAdmin = await target.query<{ count: string }>(`
      select count(*)::text
      from projectai_authorized_documents('v2-legacy-admin', 'v2-project', 'view')
      where document_id = 'v2-project-document'
    `);
    if (deniedAdmin.rows[0]?.count !== "0") {
      throw new Error("Product administrator bypassed an explicit document deny");
    }
    await target.query(`update project_documents set temporary_expires_at = now() - interval '1 minute' where id = 'v2-temporary-document'`);
    const expired = await target.query<{ count: string }>(`
      select count(*)::text
      from projectai_authorized_documents('v2-legacy-member', 'v2-project', 'view')
      where document_id = 'v2-temporary-document'
    `);
    if (expired.rows[0]?.count !== "0") {
      throw new Error("Expired temporary document remained authorized");
    }
    process.stdout.write("Non-empty 0019 to 0020 through 0024 Product V2 migration upgrade verified.\n");
  } finally {
    if (target) await target.end();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Product V2 migration verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
