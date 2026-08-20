export type ProductMapAiLimits = {
  perUserMinute: number;
  userDailyTokens: number;
  projectDailyTokens: number;
  globalConcurrent: number;
};

export const PRODUCT_MAP_AI_LIMIT_DEFAULTS: Readonly<ProductMapAiLimits> =
  Object.freeze({
    perUserMinute: 20,
    userDailyTokens: 100_000,
    projectDailyTokens: 500_000,
    globalConcurrent: 3,
  });

function testOnlyLimit(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const nodeEnvironment = Reflect.get(process.env, "NODE_ENV");
  const appEnvironment = Reflect.get(process.env, "NEXT_PUBLIC_APP_ENV");
  const isTestRuntime =
    nodeEnvironment === "test" &&
    typeof appEnvironment === "string" &&
    appEnvironment.trim().toLowerCase() === "test";
  if (!isTestRuntime) return fallback;
  const raw = Reflect.get(process.env, name);
  if (typeof raw !== "string") return fallback;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is invalid for the isolated test runtime.`);
  }
  return value;
}

/**
 * The production quotas are intentionally fixed defaults. Only the isolated
 * test runtime may opt into a larger budget for one long serial browser case;
 * production/staging environments ignore these test-only variables.
 */
export function getProductMapAiLimits(): ProductMapAiLimits {
  return {
    perUserMinute: testOnlyLimit(
      "PRODUCT_MAP_TEST_PER_USER_MINUTE_LIMIT",
      PRODUCT_MAP_AI_LIMIT_DEFAULTS.perUserMinute,
      PRODUCT_MAP_AI_LIMIT_DEFAULTS.perUserMinute,
      1_000,
    ),
    userDailyTokens: testOnlyLimit(
      "PRODUCT_MAP_TEST_USER_DAILY_TOKEN_LIMIT",
      PRODUCT_MAP_AI_LIMIT_DEFAULTS.userDailyTokens,
      PRODUCT_MAP_AI_LIMIT_DEFAULTS.userDailyTokens,
      10_000_000,
    ),
    projectDailyTokens: testOnlyLimit(
      "PRODUCT_MAP_TEST_PROJECT_DAILY_TOKEN_LIMIT",
      PRODUCT_MAP_AI_LIMIT_DEFAULTS.projectDailyTokens,
      PRODUCT_MAP_AI_LIMIT_DEFAULTS.projectDailyTokens,
      50_000_000,
    ),
    globalConcurrent: PRODUCT_MAP_AI_LIMIT_DEFAULTS.globalConcurrent,
  };
}
