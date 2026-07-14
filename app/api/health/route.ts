import { sql } from "drizzle-orm";
import { jsonResponse } from "@/lib/auth/http";
import { getDb } from "@/lib/db/client";

export async function GET(): Promise<Response> {
  try {
    // This verifies more than a TCP socket: PostgreSQL authentication must
    // succeed and the committed identity/project schema must be available.
    await getDb().execute(sql`
      select
        (select count(*) from users limit 1) as users_count,
        (select count(*) from sessions limit 1) as sessions_count,
        (select count(*) from projects limit 1) as projects_count,
        (select count(*) from project_members limit 1) as memberships_count
    `);

    return jsonResponse(
      { status: "ok" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return jsonResponse(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
