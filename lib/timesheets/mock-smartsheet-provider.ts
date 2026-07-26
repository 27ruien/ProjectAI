import { createHash } from "node:crypto";

export type MockSmartSheetResult = {
  status: "saved" | "failed" | "unknown";
  externalReference: string | null;
  externalUrl: string | null;
  verified: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

function recordKey(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 20);
}

export function mockSmartSheetResult(input: {
  description: string;
  idempotencyKey: string;
  dryRun: boolean;
  hadPreviousFailure: boolean;
}): MockSmartSheetResult {
  const key = recordKey(input.idempotencyKey);
  if (!input.dryRun && /\[mock:timeout\]/iu.test(input.description)) {
    return {
      status: "unknown",
      externalReference: null,
      externalUrl: null,
      verified: false,
      errorCode: "MOCK_TIMEOUT_RESULT_UNKNOWN",
      errorMessage: "Mock SmartSheet 模拟超时，保存结果未知，必须人工核对",
    };
  }
  if (!input.dryRun && /\[mock:readback-mismatch\]/iu.test(input.description)) {
    return {
      status: "unknown",
      externalReference: null,
      externalUrl: null,
      verified: false,
      errorCode: "MOCK_READBACK_MISMATCH",
      errorMessage: "Mock SmartSheet 模拟回读不一致，必须人工核对",
    };
  }
  if (!input.dryRun && /\[mock:unknown\]/iu.test(input.description)) {
    return {
      status: "unknown",
      externalReference: null,
      externalUrl: null,
      verified: false,
      errorCode: "MOCK_RESULT_UNKNOWN",
      errorMessage: "Mock SmartSheet 模拟保存结果未知，必须人工核对",
    };
  }
  if (
    !input.dryRun &&
    (/\[mock:failed\]/iu.test(input.description) ||
      (/\[mock:fail-once\]/iu.test(input.description) && !input.hadPreviousFailure))
  ) {
    return {
      status: "failed",
      externalReference: null,
      externalUrl: null,
      verified: false,
      errorCode: "MOCK_SAVE_FAILED",
      errorMessage: "Mock SmartSheet 模拟保存失败",
    };
  }
  return {
    status: "saved",
    externalReference: input.dryRun ? `dry-run-${key}` : `mock-record-${key}`,
    externalUrl: `https://mock-smartsheet.invalid/records/${key}`,
    verified: true,
    errorCode: null,
    errorMessage: null,
  };
}
