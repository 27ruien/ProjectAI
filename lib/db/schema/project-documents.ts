import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  documentStatusEnum,
  documentStorageStatusEnum,
  ragflowDocumentParseStatusEnum,
} from "./enums";
import { project } from "./projects";
import { user } from "./users";

export const PROJECT_DOCUMENT_CONTEXT_KINDS = [
  "general",
  "timeline",
  "meeting_notes",
  "scope",
  "proposal",
  "requirement",
  "test_report",
  "project_brief",
] as const;
export type ProjectDocumentContextKind =
  (typeof PROJECT_DOCUMENT_CONTEXT_KINDS)[number];

/**
 * Slim Project AI only owns the business mapping to a RAGFlow document.
 * Parsing, chunks, embeddings and retrieval indexes belong to RAGFlow.
 */
export const projectDocument = pgTable(
  "project_documents",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    displayName: varchar("display_name", { length: 240 }).notNull(),
    contextKind: varchar("context_kind", { length: 40 })
      .$type<ProjectDocumentContextKind>()
      .notNull()
      .default("general"),
    status: documentStatusEnum("document_status").notNull().default("pending"),
    ragflowDocumentId: varchar("ragflow_document_id", { length: 64 }),
    ragflowParseStatus: ragflowDocumentParseStatusEnum("ragflow_parse_status"),
    ragflowFailureCode: varchar("ragflow_failure_code", { length: 64 }),
    mimeType: varchar("mime_type", { length: 200 }),
    sizeBytes: bigint("ragflow_size_bytes", { mode: "number" }),
    sha256: varchar("ragflow_sha256", { length: 64 }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("project_documents_id_project_unique").on(table.id, table.projectId),
    index("project_documents_project_status_idx").on(
      table.projectId,
      table.status,
      table.updatedAt,
    ),
    uniqueIndex("project_documents_ragflow_document_uidx").on(
      table.ragflowDocumentId,
    ),
    index("project_documents_ragflow_status_idx").on(
      table.projectId,
      table.ragflowParseStatus,
      table.updatedAt,
    ),
    check(
      "project_documents_display_name_nonempty",
      sql`length(btrim(${table.displayName})) > 0`,
    ),
    check(
      "project_documents_context_kind_check",
      sql`${table.contextKind} in ('general', 'timeline', 'meeting_notes', 'scope', 'proposal', 'requirement', 'test_report', 'project_brief')`,
    ),
  ],
);

/**
 * Read-only compatibility mapping for the one-time MinIO-to-RAGFlow migration.
 * New uploads never create version rows or use the legacy object store.
 */
export const projectDocumentVersion = pgTable(
  "project_document_versions",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    isCurrent: boolean("is_current").notNull(),
    uploadId: varchar("upload_id", { length: 128 }).notNull(),
    objectKey: varchar("object_key", { length: 700 }).notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    normalizedExtension: varchar("normalized_extension", { length: 12 }).notNull(),
    declaredMimeType: varchar("declared_mime_type", { length: 200 }).notNull(),
    detectedMimeType: varchar("detected_mime_type", { length: 200 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    storageStatus: documentStorageStatusEnum("storage_status").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "project_document_versions_document_project_fk",
      columns: [table.documentId, table.projectId],
      foreignColumns: [projectDocument.id, projectDocument.projectId],
    }).onDelete("restrict"),
  ],
);

export type ProjectDocumentRecord = typeof projectDocument.$inferSelect;
