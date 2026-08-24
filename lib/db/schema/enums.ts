import { pgEnum } from "drizzle-orm/pg-core";

export const systemRoleEnum = pgEnum("system_role", ["system_admin", "standard_user"]);
export const productRoleEnum = pgEnum("product_role", ["super_admin", "admin", "member"]);
export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);
export const projectRoleEnum = pgEnum("project_role", [
  "project_manager",
  "project_member",
  "viewer",
]);
export const projectStatusEnum = pgEnum("project_status", [
  "planning",
  "active",
  "paused",
  "completed",
  "cancelled",
  "at_risk",
  "archived",
]);
export const projectStageEnum = pgEnum("project_stage", [
  "discovery",
  "planning",
  "design",
  "development",
  "testing",
  "launch",
  "operation",
]);
export const projectHealthEnum = pgEnum("project_health", [
  "healthy",
  "attention",
  "at_risk",
  "critical",
]);
export const projectKnowledgeStatusEnum = pgEnum("project_knowledge_status", [
  "pending",
  "ready",
  "failed",
]);
export const auditResultEnum = pgEnum("audit_result", [
  "succeeded",
  "denied",
  "failed",
]);
export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "active",
  "archived",
  "failed",
]);
export const documentStorageStatusEnum = pgEnum("document_storage_status", [
  "pending",
  "stored",
  "failed",
  "quarantined",
  "deleted",
]);
export const ragflowDocumentParseStatusEnum = pgEnum(
  "ragflow_document_parse_status",
  ["uploading", "processing", "ready", "failed"],
);
export const organizationRoleEnum = pgEnum("organization_role", [
  "organization_admin",
  "organization_member",
]);
export const departmentRoleEnum = pgEnum("department_role", [
  "department_admin",
  "department_member",
]);
export const departmentStatusEnum = pgEnum("department_status", ["active", "inactive"]);

export type SystemRole = (typeof systemRoleEnum.enumValues)[number];
export type ProductRole = (typeof productRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type ProjectRole = (typeof projectRoleEnum.enumValues)[number];
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type ProjectStage = (typeof projectStageEnum.enumValues)[number];
export type ProjectHealth = (typeof projectHealthEnum.enumValues)[number];
export type ProjectKnowledgeStatus = (typeof projectKnowledgeStatusEnum.enumValues)[number];
export type AuditResult = (typeof auditResultEnum.enumValues)[number];
export type DocumentStatus = (typeof documentStatusEnum.enumValues)[number];
export type DocumentStorageStatus = (typeof documentStorageStatusEnum.enumValues)[number];
export type RagflowDocumentParseStatus = (typeof ragflowDocumentParseStatusEnum.enumValues)[number];
export type OrganizationRole = (typeof organizationRoleEnum.enumValues)[number];
export type DepartmentRole = (typeof departmentRoleEnum.enumValues)[number];
export type DepartmentStatus = (typeof departmentStatusEnum.enumValues)[number];
