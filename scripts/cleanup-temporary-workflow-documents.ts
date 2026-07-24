import { sql } from "drizzle-orm";
import { closeDatabasePool, getDb } from "../lib/db/client";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const environment = (process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "")
    .trim()
    .toLowerCase();
  if (environment === "production") {
    throw new Error("TEMPORARY_WORKFLOW_CLEANUP_PRODUCTION_FORBIDDEN");
  }
  const candidates = await getDb().execute<{ id: string }>(sql`
    select id
    from project_documents
    where workflow_temporary
      and temporary_expires_at <= now()
      and document_status = 'active'
    order by temporary_expires_at
    limit 500
  `);
  if (!apply || candidates.rows.length === 0) {
    process.stdout.write(`Temporary workflow cleanup dry-run: candidates=${candidates.rows.length}.\n`);
    return;
  }
  const ids = candidates.rows.map((row) => row.id);
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`
      update project_documents
      set document_status = 'archived',
          archived_by = created_by,
          archived_at = now(),
          updated_at = now()
      where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        and workflow_temporary
        and temporary_expires_at <= now()
        and document_status = 'active'
    `);
    await tx.execute(sql`
      update document_chunks
      set is_effective = false, invalidated_at = now()
      where document_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        and is_effective
    `);
    await tx.execute(sql`
      update document_chunk_embeddings
      set status = 'invalid', invalidated_at = now()
      where document_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        and status = 'current'
    `);
  });
  process.stdout.write(`Temporary workflow cleanup applied: archived=${ids.length}.\n`);
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "TEMPORARY_WORKFLOW_CLEANUP_FAILED"}\n`);
    await closeDatabasePool();
    process.exitCode = 1;
  });
