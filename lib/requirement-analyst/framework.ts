import {
  REQUIREMENT_ANALYSIS_DOMAINS,
  type RequirementAnalysisDomain,
} from "./contracts";

export type RequirementDomainCatalogItem = {
  domain: RequirementAnalysisDomain;
  question: string;
  minimumChecks: readonly string[];
};

export const REQUIREMENT_ANALYSIS_DOMAIN_CATALOG: readonly RequirementDomainCatalogItem[] = [
  { domain: "business_goal", question: "Why should this project exist?", minimumChecks: ["business outcome", "problem to solve"] },
  { domain: "user", question: "Who uses or benefits from it?", minimumChecks: ["primary user", "stakeholder"] },
  { domain: "scenario", question: "In what situation is it used?", minimumChecks: ["trigger", "context", "desired outcome"] },
  { domain: "deliverable", question: "What must be delivered?", minimumChecks: ["artifact", "service", "handoff"] },
  { domain: "success_metric", question: "How will success be judged?", minimumChecks: ["acceptance signal", "measurement owner"] },
  { domain: "channel", question: "Where will the experience run?", minimumChecks: ["platform", "entry point", "environment"] },
  { domain: "deadline", question: "Which dates are real constraints?", minimumChecks: ["deadline", "date owner", "flexibility"] },
  { domain: "constraint", question: "What limits the solution?", minimumChecks: ["budget", "technology", "policy", "time"] },
  { domain: "user_journey", question: "What steps must each user complete?", minimumChecks: ["entry", "main path", "failure path", "completion"] },
  { domain: "functional_scope", question: "Which capabilities are in or out?", minimumChecks: ["must have", "excluded", "deferred"] },
  { domain: "identity_permission", question: "Who can see or change what?", minimumChecks: ["identity", "role", "permission boundary"] },
  { domain: "data", question: "Which data enters, changes, or leaves the system?", minimumChecks: ["fields", "source", "retention", "ownership"] },
  { domain: "ai_behavior", question: "What may AI decide or generate?", minimumChecks: ["input", "output", "evidence", "human review", "failure"] },
  { domain: "third_party_integration", question: "Which external systems are dependencies?", minimumChecks: ["API", "authentication", "test environment", "owner"] },
  { domain: "content_asset", question: "Which content and assets must be supplied?", minimumChecks: ["copy", "visual", "localization", "format"] },
  { domain: "operations_rules", question: "Which business or operating rules drive behavior?", minimumChecks: ["eligibility", "exception", "manual operation"] },
  { domain: "test_launch", question: "How will it be accepted and released?", minimumChecks: ["test", "UAT", "approval", "launch", "rollback"] },
  { domain: "project_dependency", question: "What must arrive before work can proceed?", minimumChecks: ["client input", "internal input", "sequence", "owner"] },
] as const;

export function assertRequirementDomainCatalogComplete(): void {
  const domains = new Set(REQUIREMENT_ANALYSIS_DOMAIN_CATALOG.map((item) => item.domain));
  if (
    domains.size !== REQUIREMENT_ANALYSIS_DOMAINS.length ||
    REQUIREMENT_ANALYSIS_DOMAINS.some((domain) => !domains.has(domain))
  ) {
    throw new Error("Requirement Analyst domain catalog is incomplete");
  }
}
