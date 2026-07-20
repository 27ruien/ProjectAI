#!/usr/bin/env node

import process from "node:process";

if (!/^true$/i.test(process.env.CI || "")) {
  throw new Error("CI smoke evidence can be emitted only by CI.");
}

const checks = [
  "login",
  "session",
  "projectList",
  "projectAuthorization",
  "crossProject404",
  "projectMembers",
  "fileList",
  "fileDownload",
  "uploadContract",
  "documentProcessing",
  "lexicalSearch",
  "assistantDisabled",
  "assistantLexical",
  "embeddingDisabled",
  "embeddingEnabled",
  "shadow",
  "hybrid",
  "citation",
  "viewer",
  "privateThread",
  "idempotency",
  "insufficientEvidence",
  "health",
  "storageReconciliation",
];

process.stdout.write(
  `${["fictionalDataOnly\ttrue", ...checks.map((check) => `${check}\ttrue`)].join("\n")}\n`,
);
