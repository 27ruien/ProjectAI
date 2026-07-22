import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import {
  grantEffectEnum,
  grantSubjectTypeEnum,
  knowledgePermissionEnum,
  projectKnowledgeSourceTypeEnum,
} from "./enums";
import { knowledgeSpace } from "./knowledge-spaces";
import { organization } from "./organizations";
import { projectDocument } from "./project-documents";
import { project } from "./projects";
import { user } from "./users";

export const knowledgeSpaceGrant = pgTable(
  "knowledge_space_grants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    knowledgeSpaceId: text("knowledge_space_id")
      .notNull()
      .references(() => knowledgeSpace.id, { onDelete: "cascade" }),
    subjectType: grantSubjectTypeEnum("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    permission: knowledgePermissionEnum("permission").notNull(),
    effect: grantEffectEnum("effect").notNull().default("allow"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("knowledge_space_grants_rule_uidx").on(
      table.knowledgeSpaceId,
      table.subjectType,
      table.subjectId,
      table.permission,
      table.effect,
    ),
    index("knowledge_space_grants_subject_idx").on(
      table.subjectType,
      table.subjectId,
      table.permission,
    ),
  ],
);

export const documentGrant = pgTable(
  "document_grants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => projectDocument.id, { onDelete: "cascade" }),
    subjectType: grantSubjectTypeEnum("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    permission: knowledgePermissionEnum("permission").notNull(),
    effect: grantEffectEnum("effect").notNull().default("allow"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_grants_rule_uidx").on(
      table.documentId,
      table.subjectType,
      table.subjectId,
      table.permission,
      table.effect,
    ),
    index("document_grants_subject_idx").on(
      table.subjectType,
      table.subjectId,
      table.permission,
    ),
  ],
);

export const projectKnowledgeSource = pgTable(
  "project_knowledge_sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    sourceType: projectKnowledgeSourceTypeEnum("source_type").notNull(),
    knowledgeSpaceId: text("knowledge_space_id").references(
      () => knowledgeSpace.id,
      { onDelete: "cascade" },
    ),
    documentId: text("document_id").references(() => projectDocument.id, {
      onDelete: "cascade",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("project_knowledge_sources_space_uidx")
      .on(table.projectId, table.knowledgeSpaceId)
      .where(sql`${table.sourceType} = 'knowledge_space'`),
    uniqueIndex("project_knowledge_sources_document_uidx")
      .on(table.projectId, table.documentId)
      .where(sql`${table.sourceType} = 'document'`),
    index("project_knowledge_sources_project_idx").on(
      table.projectId,
      table.isActive,
    ),
    check("project_knowledge_sources_target_check", sql`
      (${table.sourceType} = 'knowledge_space' and ${table.knowledgeSpaceId} is not null and ${table.documentId} is null)
      or (${table.sourceType} = 'document' and ${table.documentId} is not null and ${table.knowledgeSpaceId} is null)
    `),
  ],
);

export const permissionAudit = pgTable(
  "permission_audits",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "restrict",
    }),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }).notNull(),
    resourceId: text("resource_id").notNull(),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("permission_audits_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("permission_audits_resource_idx").on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    check(
      "permission_audits_event_check",
      sql`length(btrim(${table.eventType})) > 0`,
    ),
  ],
);
