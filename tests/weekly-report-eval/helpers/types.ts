export type WeeklyReportColumn =
  | "project"
  | "progress"
  | "nextPlan"
  | "milestone"
  | "support"
  | "assessment";

export type EvalTimelineTask = {
  name: string;
  startDate: string;
  endDate: string;
  status: string | null;
  owners?: string[];
};

export type EvalTimelineMilestone = {
  name: string;
  date: string;
};

export type EvalProjectFixture = {
  id: string;
  name: string;
  statusLabel: string;
  dailyReportActual: string[];
  timelinePlan: {
    plannedThisWeek: EvalTimelineTask[];
    plannedNextWeek: EvalTimelineTask[];
    milestones: EvalTimelineMilestone[];
  };
  supportingEvidence: string[];
};

export type EvalFixture = {
  id: string;
  weekStart: string;
  weekEnd: string;
  projects: EvalProjectFixture[];
  aliases?: Array<{ sourceName: string; projectId: string }>;
  ambiguousMatch?: {
    sourceName: string;
    candidateProjectIds: string[];
  };
};

export type ExpectedFact = {
  project: string;
  column: WeeklyReportColumn;
  description: string;
  /** Every group must match; alternatives inside one group are equivalent. */
  termGroups: string[][];
};

export type ForbiddenClaim = {
  project?: string;
  column?: WeeklyReportColumn;
  description: string;
  pattern: string;
};

export type OrderedClaim = {
  project: string;
  column: WeeklyReportColumn;
  description: string;
  terms: string[];
};

export type CanaryRule = {
  token: string;
  expectedProject: string;
  forbiddenProjects: string[];
};

export type WeeklyReportEvalCase = {
  id: string;
  title: string;
  fixtureId: string;
  expectedProjects: string[];
  inputFixtures: string[];
  expectedFacts: ExpectedFact[];
  forbiddenClaims: ForbiddenClaim[];
  requiredSections: string[];
  optionalClaims: string[];
  evaluationNotes: string[];
  allowedCellDates: string[];
  forbiddenCapabilities: string[];
  orderedClaims?: OrderedClaim[];
  canaries?: CanaryRule[];
  noDailyChronology?: boolean;
  maximumProgressBullets?: number;
  requiresConfirmation?: boolean;
};

export type AgentEvalRun = {
  caseId: string;
  agent: string;
  finalized: boolean;
  markdown: string | null;
  capabilityRequests: string[];
};

export type EvalIssue = {
  caseId: string;
  code: string;
  message: string;
};

export type EvalResult = {
  caseId: string;
  status: "PASS" | "FAIL";
  issues: EvalIssue[];
};
