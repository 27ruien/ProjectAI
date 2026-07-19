import { mkdir, readFile, writeFile } from "node:fs/promises";

const integrationLog = await readFile(
  "test-logs/retrieval-integration.log",
  "utf8",
);
const normalizedIntegrationLog = integrationLog.replace(
  // Node uses the spec reporter on an interactive terminal and TAP in CI.
  // Normalize ANSI before accepting either reporter's explicit pass line.
  /\u001b\[[0-9;]*m/g,
  "",
);
const passedTest = (label: string): boolean =>
  normalizedIntegrationLog.split("\n").some((line) => {
    const trimmed = line.trim();
    return (
      trimmed === `✔ ${label}` ||
      /^ok\s+\d+\s+-\s+/.test(trimmed) &&
        trimmed.replace(/^ok\s+\d+\s+-\s+/, "") === label
    );
  });
const requiredChecks = {
  lexicalNoQueryEmbedding: "keeps lexical mode identical and never creates a query embedding call",
  shadowEvidenceUnchanged: "records shadow candidates while keeping lexical evidence",
  hybridSemanticHit: "uses vector evidence for a semantic query with no lexical match",
  projectAndLifecycleScope: "never admits a more similar cross-project, old-version, or archived chunk",
  coverageFallback: "falls back before dispatch when coverage is below 98 percent",
  timeoutUnknownNoRetry: "falls back on post-dispatch unknown without retrying or mutating the terminal call",
  usageNullAndNoCharge: "releases a confirmed pre-dispatch reservation and preserves usage-null reservations",
  dailyBudget: "enforces the independent daily budget and falls back without a second call",
  idempotency: "replays one Retrieval Run and one Query Embedding Call for the same key",
  immutableProfile: "falls back when the immutable profile is disabled",
  databaseProjectConstraint: "rejects cross-project Candidate ownership at the database boundary",
};
const checks = Object.fromEntries(
  Object.entries(requiredChecks).map(([key, label]) => [
    key,
    passedTest(label),
  ]),
);
if (
  /^\s*not ok\b/m.test(normalizedIntegrationLog) ||
  !Object.values(checks).every(Boolean)
) {
  throw new Error("Retrieval CI verification log is incomplete.");
}
const evaluation = JSON.parse(
  await readFile("review-artifacts/retrieval-evaluation.json", "utf8"),
) as { passed?: boolean; safety?: Record<string, number>; gates?: Record<string, boolean> };
if (!evaluation.passed) throw new Error("Retrieval quality gates did not pass.");
const summary = {
  schemaVersion: 1,
  fixtures: "fictional-only",
  shadowReport: {
    lexicalEvidenceUsed: checks.shadowEvidenceUnchanged,
    hybridCandidatesRecorded: checks.shadowEvidenceUnchanged,
    projectScopeLeakage: evaluation.safety?.crossProjectLeakage ?? null,
  },
  hybridSmoke: {
    semanticHit: checks.hybridSemanticHit,
    exactAndLexicalRegression: checks.lexicalNoQueryEmbedding,
  },
  fallbackSmoke: {
    coverage: checks.coverageFallback,
    timeoutUnknown: checks.timeoutUnknownNoRetry,
    budget: checks.dailyBudget,
  },
  costAndIdempotency: {
    usageNullAndConfirmedNoCharge: checks.usageNullAndNoCharge,
    oneRunAndCallPerKey: checks.idempotency,
  },
  safety: {
    projectAndLifecycleScope: checks.projectAndLifecycleScope,
    databaseProjectConstraint: checks.databaseProjectConstraint,
    immutableProfile: checks.immutableProfile,
    evaluation: evaluation.safety,
  },
  qualityGates: evaluation.gates,
  passed: true,
};
await mkdir("review-artifacts", { recursive: true });
await writeFile(
  "review-artifacts/retrieval-verification-summary.json",
  `${JSON.stringify(summary, null, 2)}\n`,
  { mode: 0o600 },
);
await writeFile(
  "review-artifacts/retrieval-verification-summary.md",
  [
    "# Retrieval Verification Summary",
    "",
    "- Fixtures: fictional only",
    "- Shadow: lexical Evidence preserved and Hybrid Candidates recorded",
    "- Hybrid: semantic no-keyword hit verified",
    "- Fallback: coverage, timeout/unknown, and budget verified",
    "- Cost: Usage-null, confirmed-no-charge, daily budget, and idempotency verified",
    "- Scope: cross-project, old version, archived, invalid, and database constraints verified",
    "- Quality gates: PASS",
    "",
  ].join("\n"),
  { mode: 0o600 },
);
process.stdout.write("Retrieval CI evidence summary written from passing test logs.\n");
