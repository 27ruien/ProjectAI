import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organization } from "./organizations";
import { project } from "./projects";
import { projectDocument, projectDocumentVersion } from "./project-documents";
import { user } from "./users";

/**
 * Provider credentials are either a legacy deployment-secret reference or an
 * AES-GCM ciphertext held in the adjacent server-only credential vault. Raw
 * credentials are never returned through the API.
 */
export const aiProviderProfile = pgTable("ai_provider_profiles", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  providerType: varchar("provider_type", { length: 32 }).notNull(),
  baseUrl: varchar("base_url", { length: 500 }).notNull(),
  region: varchar("region", { length: 80 }).notNull(),
  secretRef: varchar("secret_ref", { length: 80 }).notNull(),
  credentialMode: varchar("credential_mode", { length: 24 })
    .notNull()
    .default("environment"),
  modelDiscoverySupported: boolean("model_discovery_supported")
    .notNull()
    .default(false),
  enabled: boolean("enabled").notNull().default(false),
  lastTestStatus: varchar("last_test_status", { length: 24 }).notNull().default("not_tested"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true, mode: "date" }),
  lastTestErrorCode: varchar("last_test_error_code", { length: 80 }),
  lastTestLatencyMs: integer("last_test_latency_ms"),
  lastTestRequestId: varchar("last_test_request_id", { length: 240 }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  updatedBy: text("updated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_provider_profile_org_name_uidx").on(table.organizationId, table.name),
  index("ai_provider_profile_org_enabled_idx").on(table.organizationId, table.enabled),
  check("ai_provider_profile_type_check", sql`${table.providerType} in ('dashscope', 'openai_compatible')`),
  check("ai_provider_profile_credential_mode_check", sql`${table.credentialMode} in ('environment', 'managed')`),
  check("ai_provider_profile_test_check", sql`${table.lastTestStatus} in ('not_tested', 'passed', 'failed')`),
]);

/** Ciphertext only. The AES key is a server secret mounted into the App. */
export const aiProviderCredential = pgTable("ai_provider_credentials", {
  providerProfileId: text("provider_profile_id")
    .primaryKey()
    .references(() => aiProviderProfile.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: varchar("iv", { length: 64 }).notNull(),
  authTag: varchar("auth_tag", { length: 64 }).notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  apiKeyLast4: varchar("api_key_last4", { length: 4 }).notNull(),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  updatedBy: text("updated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  check("ai_provider_credential_key_version_check", sql`${table.keyVersion} = 1`),
  check("ai_provider_credential_last4_check", sql`length(${table.apiKeyLast4}) = 4`),
]);

export const aiGenerationModel = pgTable("ai_generation_models", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
  providerProfileId: text("provider_profile_id").notNull().references(() => aiProviderProfile.id, { onDelete: "restrict" }),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  modelId: varchar("model_id", { length: 160 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  supportsJson: boolean("supports_json").notNull().default(true),
  supportsThinking: boolean("supports_thinking").notNull().default(false),
  disableThinkingForJson: boolean("disable_thinking_for_json").notNull().default(true),
  lastTestStatus: varchar("last_test_status", { length: 24 }).notNull().default("not_tested"),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true, mode: "date" }),
  lastTestErrorCode: varchar("last_test_error_code", { length: 80 }),
  lastTestLatencyMs: integer("last_test_latency_ms"),
  lastTestRequestId: varchar("last_test_request_id", { length: 240 }),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  updatedBy: text("updated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_generation_model_org_provider_model_uidx").on(table.organizationId, table.providerProfileId, table.modelId),
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
  lastTestErrorCode: varchar("last_test_error_code", { length: 80 }),
  lastTestLatencyMs: integer("last_test_latency_ms"),
  lastTestRequestId: varchar("last_test_request_id", { length: 240 }),
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
  basedOnOverviewId: text("based_on_overview_id").references(
    (): AnyPgColumn => guidedRequirementOverview.id,
    { onDelete: "set null" },
  ),
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
  index("guided_requirement_overview_lineage_idx").on(table.projectId, table.basedOnOverviewId),
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

/** An auditable, temporary model run. Choosing a candidate is the only path to a formal overview draft. */
export const guidedRequirementOverviewComparisonRun = pgTable("guided_requirement_overview_comparison_runs", {
  id: text("id").primaryKey(),
  overviewId: text("overview_id").notNull().references(() => guidedRequirementOverview.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => project.id, { onDelete: "cascade" }),
  sourceDigest: varchar("source_digest", { length: 64 }).notNull(),
  promptVersion: varchar("prompt_version", { length: 64 }).notNull(),
  promptDigest: varchar("prompt_digest", { length: 64 }).notNull(),
  temperatureMilli: integer("temperature_milli").notNull(),
  maxOutputTokens: integer("max_output_tokens").notNull(),
  citationCount: integer("citation_count").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("running"),
  selectedCandidateId: text("selected_candidate_id"),
  createdBy: text("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  index("guided_requirement_overview_comparison_overview_idx").on(table.overviewId, table.createdAt),
  index("guided_requirement_overview_comparison_project_idx").on(table.projectId, table.createdAt),
  check("guided_requirement_overview_comparison_status_check", sql`${table.status} in ('running','ready','failed','selected')`),
  check("guided_requirement_overview_comparison_config_check", sql`${table.temperatureMilli} between 0 and 2000 and ${table.maxOutputTokens} between 128 and 16384 and ${table.citationCount} >= 0`),
]);

export const guidedRequirementOverviewComparisonCandidate = pgTable("guided_requirement_overview_comparison_candidates", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => guidedRequirementOverviewComparisonRun.id, { onDelete: "cascade" }),
  candidateOrder: integer("candidate_order").notNull(),
  generationModelId: text("generation_model_id").notNull().references(() => aiGenerationModel.id, { onDelete: "restrict" }),
  modelDisplayName: varchar("model_display_name", { length: 120 }).notNull(),
  providerName: varchar("provider_name", { length: 120 }).notNull(),
  actualModel: varchar("actual_model", { length: 160 }),
  status: varchar("status", { length: 24 }).notNull().default("running"),
  items: jsonb("items").$type<RequirementOverviewItem[]>().notNull().default(sql`'[]'::jsonb`),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  latencyMs: integer("latency_ms"),
  failureCode: varchar("failure_code", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  uniqueIndex("guided_requirement_overview_candidate_run_order_uidx").on(table.runId, table.candidateOrder),
  check("guided_requirement_overview_candidate_status_check", sql`${table.status} in ('running','ready','failed')`),
  check("guided_requirement_overview_candidate_usage_check", sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0) and (${table.totalTokens} is null or ${table.totalTokens} >= 0) and (${table.latencyMs} is null or ${table.latencyMs} >= 0)`),
]);
