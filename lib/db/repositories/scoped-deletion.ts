import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "../client";

type ColumnRow = {
  table_schema: string;
  table_name: string;
  column_name: string;
};

type ForeignKeyRow = {
  child_schema: string;
  child_table: string;
  parent_schema: string;
  parent_table: string;
};

type ScopedColumnSet = {
  schema: string;
  table: string;
  columns: Set<string>;
};

const PRESERVED_PROJECT_AUDIT_TABLES = new Set(["audit_events"]);

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

async function listScopedTables(
  tx: DatabaseTransaction,
  requiredColumns: readonly string[],
): Promise<ScopedColumnSet[]> {
  const rows = (await tx.execute(sql`
    select c.table_schema, c.table_name, c.column_name
    from information_schema.columns c
    inner join information_schema.tables t
      on t.table_schema = c.table_schema
      and t.table_name = c.table_name
      and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name in (${sql.join(
        requiredColumns.map((column) => sql`${column}`),
        sql`, `,
      )})
    order by c.table_name, c.column_name
  `)) as unknown as ColumnRow[];

  const grouped = new Map<string, ScopedColumnSet>();
  for (const row of rows) {
    const key = tableKey(row.table_schema, row.table_name);
    const current = grouped.get(key) ?? {
      schema: row.table_schema,
      table: row.table_name,
      columns: new Set<string>(),
    };
    current.columns.add(row.column_name);
    grouped.set(key, current);
  }

  return [...grouped.values()].filter((item) =>
    requiredColumns.every((column) => item.columns.has(column)),
  );
}

async function listForeignKeys(
  tx: DatabaseTransaction,
): Promise<ForeignKeyRow[]> {
  return (await tx.execute(sql`
    select
      tc.table_schema as child_schema,
      tc.table_name as child_table,
      ccu.table_schema as parent_schema,
      ccu.table_name as parent_table
    from information_schema.table_constraints tc
    inner join information_schema.constraint_column_usage ccu
      on ccu.constraint_schema = tc.constraint_schema
      and ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
  `)) as unknown as ForeignKeyRow[];
}

/**
 * Foreign keys in this schema are deliberately restrictive in a number of
 * places. Build a child-before-parent order from the live database metadata so
 * deletion remains complete without changing production schema or requiring a
 * migration just to remove user-owned data.
 */
function childFirstOrder(
  tables: ScopedColumnSet[],
  foreignKeys: ForeignKeyRow[],
): ScopedColumnSet[] {
  const byKey = new Map(tables.map((table) => [tableKey(table.schema, table.table), table]));
  const edges = foreignKeys
    .filter(
      (edge) =>
        byKey.has(tableKey(edge.child_schema, edge.child_table)) &&
        byKey.has(tableKey(edge.parent_schema, edge.parent_table)) &&
        tableKey(edge.child_schema, edge.child_table) !==
          tableKey(edge.parent_schema, edge.parent_table),
    )
    .map((edge) => ({
      child: tableKey(edge.child_schema, edge.child_table),
      parent: tableKey(edge.parent_schema, edge.parent_table),
    }));

  const remaining = new Set(byKey.keys());
  const ordered: ScopedColumnSet[] = [];
  while (remaining.size > 0) {
    const next = [...remaining].find(
      (candidate) =>
        !edges.some(
          (edge) => edge.parent === candidate && remaining.has(edge.child),
        ),
    );
    if (!next) {
      // A cyclic FK group cannot be topologically ordered. Keep the failure
      // visible to PostgreSQL instead of silently skipping rows.
      ordered.push(
        ...[...remaining]
          .sort()
          .map((key) => byKey.get(key) as ScopedColumnSet),
      );
      break;
    }
    ordered.push(byKey.get(next) as ScopedColumnSet);
    remaining.delete(next);
  }
  return ordered;
}

export async function deleteScopedRows(
  tx: DatabaseTransaction,
  input: {
    projectId: string;
    documentId?: string;
  },
): Promise<number> {
  const requiredColumns = input.documentId
    ? (["project_id", "document_id"] as const)
    : (["project_id"] as const);
  const tables = (await listScopedTables(tx, requiredColumns)).filter(
    (table) =>
      !PRESERVED_PROJECT_AUDIT_TABLES.has(table.table) &&
      table.table !== "projects",
  );
  const order = childFirstOrder(tables, await listForeignKeys(tx));
  let deleted = 0;

  for (const table of order) {
    const tableRef = `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.table)}`;
    const projectColumn = sql.raw(quoteIdentifier("project_id"));
    const documentColumn = sql.raw(quoteIdentifier("document_id"));
    const predicate = input.documentId
      ? sql`${projectColumn} = ${input.projectId} and ${documentColumn} = ${input.documentId}`
      : sql`${projectColumn} = ${input.projectId}`;
    const result = (await tx.execute(
      sql`delete from ${sql.raw(tableRef)} where ${predicate}`,
    )) as unknown as { rowCount?: number };
    deleted += result.rowCount ?? 0;
  }
  return deleted;
}
