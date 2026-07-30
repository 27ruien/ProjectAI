import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { department, organization } from "./organizations";
import { projectDocument, projectDocumentVersion } from "./project-documents";
import { project } from "./projects";
import { user } from "./users";

export type FocusedRequirementSection = {
  key: string;
  title: string;
  content: string;
  citationLabels: string[];
};

export const companyKnowledgeDocument = pgTable(
  "company_knowledge_documents",
  {
    documentId: text("document_id")
      .primaryKey()
      .references(() => projectDocument.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 40 }).notNull(),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 })
      .notNull()
      .default("draft"),
    audience: varchar("audience", { length: 24 })
      .notNull()
      .default("organization"),
    departmentId: text("department_id").references(() => department.id, {
      onDelete: "restrict",
    }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("company_knowledge_org_status_idx").on(
      table.organizationId,
      table.lifecycleStatus,
      table.category,
      table.updatedAt,
    ),
    check(
      "company_knowledge_category_check",
      sql`${table.category} in ('charter', 'hr', 'project_management', 'security', 'finance', 'template', 'other')`,
    ),
    check(
      "company_knowledge_lifecycle_check",
      sql`${table.lifecycleStatus} in ('draft', 'published', 'expired', 'archived')`,
    ),
    check(
      "company_knowledge_audience_check",
      sql`${table.audience} in ('organization', 'department', 'admin')`,
    ),
    check(
      "company_knowledge_department_check",
      sql`(${table.audience} = 'department' and ${table.departmentId} is not null) or (${table.audience} <> 'department' and ${table.departmentId} is null)`,
    ),
  ],
);

export const focusedRequirementDocument = pgTable(
  "focused_requirement_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("generating"),
    sections: jsonb("sections")
      .$type<FocusedRequirementSection[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    markdown: text("markdown").notNull().default(""),
    sourceDigest: varchar("source_digest", { length: 64 }).notNull(),
    projectSourceCount: integer("project_source_count").notNull().default(0),
    companySourceCount: integer("company_source_count").notNull().default(0),
    sourceSnapshotAt: timestamp("source_snapshot_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    skillId: varchar("skill_id", { length: 80 })
      .notNull()
      .default("focused-requirement-document-v1"),
    modelProfileId: varchar("model_profile_id", { length: 120 }).notNull(),
    provider: varchar("provider", { length: 40 }),
    requestedModel: varchar("requested_model", { length: 120 }),
    actualModel: varchar("actual_model", { length: 120 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    latencyMs: integer("latency_ms"),
    linkedDocumentId: text("linked_document_id").references(
      () => projectDocument.id,
      { onDelete: "set null" },
    ),
    failureCode: varchar("failure_code", { length: 80 }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    updatedBy: text("updated_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "restrict",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("focused_requirement_project_version_uidx").on(
      table.projectId,
      table.versionNumber,
    ),
    index("focused_requirement_project_status_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
    check(
      "focused_requirement_status_check",
      sql`${table.status} in ('generating', 'draft', 'published', 'failed')`,
    ),
    check(
      "focused_requirement_version_check",
      sql`${table.versionNumber} > 0`,
    ),
    check(
      "focused_requirement_usage_check",
      sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0)
        and (${table.outputTokens} is null or ${table.outputTokens} >= 0)
        and (${table.totalTokens} is null or ${table.totalTokens} >= 0)
        and (${table.latencyMs} is null or ${table.latencyMs} >= 0)`,
    ),
    check(
      "focused_requirement_source_count_check",
      sql`${table.projectSourceCount} >= 0 and ${table.companySourceCount} >= 0`,
    ),
  ],
);

export const focusedRequirementCitation = pgTable(
  "focused_requirement_citations",
  {
    id: text("id").primaryKey(),
    requirementDocumentId: text("requirement_document_id")
      .notNull()
      .references(() => focusedRequirementDocument.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    citationIndex: integer("citation_index").notNull(),
    label: varchar("label", { length: 8 }).notNull(),
    documentId: text("document_id")
      .notNull()
      .references(() => projectDocument.id, { onDelete: "restrict" }),
    versionId: text("version_id")
      .notNull()
      .references(() => projectDocumentVersion.id, { onDelete: "restrict" }),
    chunkId: text("chunk_id").notNull(),
    sourceScope: varchar("source_scope", { length: 24 }).notNull(),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    sourceLocator: jsonb("source_locator")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    excerpt: text("excerpt").notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("focused_requirement_citation_label_uidx").on(
      table.requirementDocumentId,
      table.label,
    ),
    index("focused_requirement_citation_source_idx").on(
      table.projectId,
      table.documentId,
      table.versionId,
    ),
    check(
      "focused_requirement_citation_index_check",
      sql`${table.citationIndex} between 1 and 30`,
    ),
    check(
      "focused_requirement_citation_scope_check",
      sql`${table.sourceScope} in ('project', 'organization')`,
    ),
  ],
);

export type CompanyKnowledgeDocumentRecord =
  typeof companyKnowledgeDocument.$inferSelect;
export type FocusedRequirementDocumentRecord =
  typeof focusedRequirementDocument.$inferSelect;
export type FocusedRequirementCitationRecord =
  typeof focusedRequirementCitation.$inferSelect;
