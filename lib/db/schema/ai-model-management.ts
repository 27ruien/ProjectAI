import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organization } from "./organizations";
import { project } from "./projects";
import { projectDocument, projectDocumentVersion } from "./project-documents";
import { user } from "./users";

/**
 * These records deliberately contain only a reference to a server-managed
 * secret.  Raw credentials are never persisted or returned through the API.
 */
export const aiProviderProfile = pgTable("ai_provider_profiles", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  providerType: varchar("provider_type", { length: 32 }).notNull(),
  baseUrl: varchar("base_url", { length: 500 }).notNull(),
  region: varchar("region", { length: 80 }).notNull(),
  secretRef: varchar("secret_ref", { length: 80 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  lastTestStatus: varchar("last_test_status", { length: 24 }).notNull().default("not_tested"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true, mode: "date" }),
  lastTestErrorCode: varchar("last_test_error_code", { length: 80 }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  updatedBy: text("updated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_provider_profile_org_name_uidx").on(table.organizationId, table.name),
  index("ai_provider_profile_org_enabled_idx").on(table.organizationId, table.enabled),
  check("ai_provider_profile_type_check", sql`${table.providerType} in ('dashscope', 'openai_compatible')`),
  check("ai_provider_profile_test_check", sql`${table.lastTestStatus} in ('not_tested', 'passed', 'failed')`),
]);

export const aiGenerationModel = pgTable("ai_generation_models", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  providerProfileId: text("provider_profile_id").notNull().references(() => aiProviderProfile.id, { onDelete: "restrict" }),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  modelId: varchar("model_id", { length: 160 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  supportsJson: boolean("supports_json").notNull().default(true),
  lastTestStatus: varchar("last_test_status", { length: 24 }).notNull().default("not_tested"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true, mode: "date" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  updatedBy: text("updated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_generation_model_org_model_uidx").on(table.organizationId, table.modelId),
  index("ai_generation_model_provider_idx").on(table.providerProfileId, table.enabled),
  check("ai_generation_model_test_check", sql`${table.lastTestStatus} in ('not_tested', 'passed', 'failed')`),
]);

export const aiEmbeddingModel = pgTable("ai_embedding_models", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  providerProfileId: text("provider_profile_id").notNull().references(() => aiProviderProfile.id, { onDelete: "restrict" }),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  modelId: varchar("model_id", { length: 160 }).notNull(),
  dimensions: integer("dimensions").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  lastTestStatus: varchar("last_test_status", { length: 24 }).notNull().default("not_tested"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true, mode: "date" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  updatedBy: text("updated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_embedding_model_org_model_uidx").on(table.organizationId, table.modelId),
  check("ai_embedding_model_dimensions_check", sql`${table.dimensions} = 1024`),
  check("ai_embedding_model_test_check", sql`${table.lastTestStatus} in ('not_tested', 'passed', 'failed')`),
]);

export const aiScenarioBinding = pgTable("ai_scenario_bindings", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  scenario: varchar("scenario", { length: 80 }).notNull(),
  generationModelId: text("generation_model_id").references(() => aiGenerationModel.id, { onDelete: "restrict" }),
  embeddingModelId: text("embedding_model_id").references(() => aiEmbeddingModel.id, { onDelete: "restrict" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedBy: text("updated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_scenario_binding_org_scenario_uidx").on(table.organizationId, table.scenario),
  check("ai_scenario_binding_name_check", sql`${table.scenario} in ('general_chat','project_grounded_chat','requirement_overview_prefill','requirement_overview_guidance','requirement_markdown_generation')`),
]);

export type RequirementOverviewItem = {
  id: string;
  label: string;
  status: "confirmed" | "user_confirmed" | "inferred" | "missing" | "conflict" | "not_applicable";
  value: string;
  citationLabels: string[];
  alternatives?: Array<{ value: string; citationLabels: string[] }>;
};
export type RequirementOverviewQuestion = {
  id: string;
  group: string;
  prompt: string;
  required: boolean;
  answer: string;
  status: "pending" | "answered" | "not_applicable";
  citationLabels: string[];
  targetFieldKeys?: string[];
  reason?: string;
  highRisk?: boolean;
};

export const guidedRequirementOverview = pgTable("guided_requirement_overviews", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("prefilled"),
  items: jsonb("items").$type<RequirementOverviewItem[]>().notNull().default(sql`'[]'::jsonb`),
  questions: jsonb("questions").$type<RequirementOverviewQuestion[]>().notNull().default(sql`'[]'::jsonb`),
  markdown: text("markdown").notNull().default(""),
  sourceDigest: varchar("source_digest", { length: 64 }).notNull(),
  sourceSnapshotAt: timestamp("source_snapshot_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  generationModelId: text("generation_model_id").references(() => aiGenerationModel.id, { onDelete: "restrict" }),
  actualModel: varchar("actual_model", { length: 160 }),
  failureCode: varchar("failure_code", { length: 80 }),
  savedDocumentId: text("saved_document_id").references(() => projectDocument.id, { onDelete: "set null" }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  updatedBy: text("updated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("guided_requirement_overview_project_version_uidx").on(table.projectId, table.versionNumber),
  index("guided_requirement_overview_project_updated_idx").on(table.projectId, table.updatedAt),
  check("guided_requirement_overview_status_check", sql`${table.status} in ('prefilled','needs_confirmation','ready','generated','failed')`),
]);

export const guidedRequirementOverviewCitation = pgTable("guided_requirement_overview_citations", {
  id: text("id").primaryKey(),
  overviewId: text("overview_id").notNull().references(() => guidedRequirementOverview.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 8 }).notNull(),
  documentId: text("document_id").notNull().references(() => projectDocument.id, { onDelete: "restrict" }),
  versionId: text("version_id").notNull().references(() => projectDocumentVersion.id, { onDelete: "restrict" }),
  chunkId: text("chunk_id").notNull(),
  sourceScope: varchar("source_scope", { length: 24 }).notNull(),
  displayName: varchar("display_name", { length: 240 }).notNull(),
  excerpt: text("excerpt").notNull(),
  sourceLocator: jsonb("source_locator").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
}, (table) => [uniqueIndex("guided_requirement_overview_citation_uidx").on(table.overviewId, table.label)]);
