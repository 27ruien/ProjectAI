import { pgEnum } from "drizzle-orm/pg-core";

export const systemRoleEnum = pgEnum("system_role", [
  "system_admin",
  "standard_user",
]);

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

export const auditResultEnum = pgEnum("audit_result", [
  "succeeded",
  "denied",
  "failed",
]);

export type SystemRole = (typeof systemRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type ProjectRole = (typeof projectRoleEnum.enumValues)[number];
export type ProjectStatus = (typeof projectStatusEnum.enumValues)[number];
export type ProjectStage = (typeof projectStageEnum.enumValues)[number];
export type ProjectHealth = (typeof projectHealthEnum.enumValues)[number];
export type AuditResult = (typeof auditResultEnum.enumValues)[number];
