import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { aiEmbeddingProfile } from "./document-embeddings";

export const aiRetrievalProfile = pgTable(
  "ai_retrieval_profiles",
  {
    id: text("id").primaryKey(),
    profileVersion: integer("profile_version").notNull(),
    lexicalCandidateLimit: integer("lexical_candidate_limit").notNull(),
    vectorCandidateLimit: integer("vector_candidate_limit").notNull(),
    fusedCandidateLimit: integer("fused_candidate_limit").notNull(),
    evidenceLimit: integer("evidence_limit").notNull(),
    rrfK: integer("rrf_k").notNull(),
    lexicalWeight: doublePrecision("lexical_weight").notNull(),
    vectorWeight: doublePrecision("vector_weight").notNull(),
    vectorMaxDistance: doublePrecision("vector_max_distance").notNull(),
    minEmbeddingCoverageBps: integer("min_embedding_coverage_bps").notNull(),
    embeddingProfileId: text("embedding_profile_id")
      .notNull()
      .references(() => aiEmbeddingProfile.id, { onDelete: "restrict" }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("ai_retrieval_profiles_version_unique").on(
      table.id,
      table.profileVersion,
    ),
    index("ai_retrieval_profiles_enabled_idx").on(table.enabled),
    check("ai_retrieval_profiles_values_check", sql`
      length(btrim(${table.id})) > 0
      and ${table.profileVersion} > 0
      and ${table.lexicalCandidateLimit} between 1 and 30
      and ${table.vectorCandidateLimit} between 1 and 30
      and ${table.fusedCandidateLimit} between 1 and 30
      and ${table.evidenceLimit} between 1 and 10
      and ${table.rrfK} between 1 and 1000
      and ${table.lexicalWeight} > 0
      and ${table.vectorWeight} > 0
      and ${table.vectorMaxDistance} between 0 and 2
      and ${table.minEmbeddingCoverageBps} between 0 and 10000
    `),
  ],
);

export type AiRetrievalProfileRecord = typeof aiRetrievalProfile.$inferSelect;
