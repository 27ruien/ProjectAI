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

    const headers = new Headers({ "cache-control": "no-store" });
    const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim();
    if (commitSha && /^[0-9a-f]{40}$/i.test(commitSha)) {
      // A revision identifier is non-secret deployment provenance. Keep it in
      // a header so the established minimal health body remains stable.
      headers.set("x-projectai-commit-sha", commitSha.toLowerCase());
    }
    return jsonResponse({ status: "ok" }, { headers });
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
