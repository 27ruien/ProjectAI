import { readFile } from "node:fs/promises";
import { WEEKLY_REPORT_EVAL_CASES } from "./cases/cases";
import { codexReferenceRun } from "./expected/codex-reference-runs";
import { evaluateWeeklyReportRun } from "./helpers/evaluator";

const results = WEEKLY_REPORT_EVAL_CASES.map((evalCase) =>
  evaluateWeeklyReportRun(evalCase, codexReferenceRun(evalCase.id)),
);
const serviceSource = await readFile(
  new URL("../../lib/weekly-report/service.ts", import.meta.url),
  "utf8",
);
const matchStart = serviceSource.indexOf("const matches = matchProjects");
const gateStart = serviceSource.indexOf("matchConfirmationRequired(matches)", matchStart);
const confirmationAuditStart = serviceSource.indexOf(
  "writeAuditEvent(confirmationRequiredAuditEvent",
  gateStart,
);
const gateReturn = serviceSource.indexOf("return confirmation", confirmationAuditStart);
const aliasStart = serviceSource.indexOf("await saveConfirmedAliases", gateReturn);
const groupingStart = serviceSource.indexOf("const projectIdBySource", gateReturn);
const hasUnresolvedMatchGate =
  matchStart >= 0 &&
  matchStart < gateStart &&
  gateStart < confirmationAuditStart &&
  confirmationAuditStart < gateReturn &&
  gateReturn < aliasStart &&
  gateReturn < groupingStart;
const hasNonFinalConfirmationAudit =
  /eventType: "weekly_report_match_confirmation_required"/u.test(serviceSource) &&
  /result: "denied" as const/u.test(serviceSource);

const failedCases = results.filter((result) => result.status === "FAIL");
const readinessFindings = [
  ...failedCases.map((result) => ({
    id: result.caseId,
    severity: "S2",
    message: result.issues.map((item) => item.message).join("；"),
  })),
  ...(!hasUnresolvedMatchGate ? [{
    id: "WR-EVAL-09-FINALIZATION-GATE",
    severity: "S2",
    message: "当前 package builder 未在 needs_confirmation 后、Context 分组前停止最终 Execution Package 构建",
  }] : []),
  ...(!hasNonFinalConfirmationAudit ? [{
    id: "WR-EVAL-09-CONFIRMATION-AUDIT",
    severity: "S2",
    message: "needs_confirmation 未记录为独立 non-final Audit",
  }] : []),
];

process.stdout.write(JSON.stringify({
  suite: "project-weekly-report",
  agent: "Codex",
  referenceCases: results.length,
  referencePass: results.length - failedCases.length,
  referenceFail: failedCases.length,
  hasUnresolvedMatchGate,
  hasNonFinalConfirmationAudit,
  readiness: readinessFindings.length === 0 ? "PASS" : "FAIL",
  findings: readinessFindings,
}, null, 2) + "\n");

if (readinessFindings.length > 0) process.exitCode = 1;
