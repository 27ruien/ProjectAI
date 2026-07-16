import { sql } from "drizzle-orm";
import { jsonResponse } from "@/lib/auth/http";
import { getDb } from "@/lib/db/client";
import {
  DOCUMENT_WORKER_VERSION,
  getDocumentProcessingConfig,
} from "@/lib/documents/processing/config";

export async function GET(): Promise<Response> {
  try {
    // This verifies more than a TCP socket: PostgreSQL authentication must
    // succeed and the committed identity/project schema must be available.
    const databaseHealth = await getDb().execute(sql`
      select
        (select count(*) from users limit 1) as users_count,
        (select count(*) from sessions limit 1) as sessions_count,
        (select count(*) from projects limit 1) as projects_count,
        (select count(*) from project_members limit 1) as memberships_count,
        (select count(*) from document_ingestion_jobs limit 1) as ingestion_jobs_count,
        (select count(*) from document_sections limit 1) as sections_count,
        (select count(*) from document_chunks limit 1) as chunks_count,
        exists(select 1 from pg_extension where extname = 'pg_trgm') as pg_trgm_enabled
    `);
    const row = databaseHealth.rows[0] as
      | { pg_trgm_enabled?: boolean }
      | undefined;
    if (row?.pg_trgm_enabled !== true) {
      throw new Error("Required pg_trgm extension is unavailable.");
    }

    const headers = new Headers({ "cache-control": "no-store" });
    const commitSha = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim();
    if (commitSha && /^[0-9a-f]{40}$/i.test(commitSha)) {
      // A revision identifier is non-secret deployment provenance. Keep it in
      // a header so the established minimal health body remains stable.
      headers.set("x-projectai-commit-sha", commitSha.toLowerCase());
    }
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION?.trim();
    if (appVersion) headers.set("x-projectai-app-version", appVersion);
    const processingConfig = getDocumentProcessingConfig();
    headers.set("x-projectai-worker-version", DOCUMENT_WORKER_VERSION);
    headers.set("x-projectai-parser-version", processingConfig.parserVersion);
    headers.set("x-projectai-chunker-version", processingConfig.chunkerVersion);
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
