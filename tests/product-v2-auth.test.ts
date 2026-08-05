import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { safeReturnTo } from "../components/auth/auth-client";
import { safeReturnTo as safeServerReturnTo } from "../lib/auth/session";
import { POST as authPost } from "../app/api/auth/[...all]/route";
import {
  getAuthProviderConfig,
  publicAuthProvider,
} from "../lib/auth/providers";
import {
  STAGING_TEST_LOGIN_PATH,
  validateStagingTestLoginRequest,
} from "../lib/auth/staging-test-login";

const original = {
  environment: process.env.NEXT_PUBLIC_APP_ENV,
  nodeEnvironment: process.env.NODE_ENV,
  provider: process.env.AUTH_PROVIDER,
  allowMock: process.env.ALLOW_MOCK_WECOM_AUTH,
  allowStagingTestLogin: process.env.ALLOW_STAGING_TEST_LOGIN,
  allowLegacyCredentialTest: process.env.ALLOW_LEGACY_CREDENTIAL_TEST_AUTH,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  betterAuthUrl: process.env.BETTER_AUTH_URL,
  trustedOrigins: process.env.AUTH_TRUSTED_ORIGINS,
};

function restore(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore("NEXT_PUBLIC_APP_ENV", original.environment);
  if (original.nodeEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: original.nodeEnvironment });
  restore("AUTH_PROVIDER", original.provider);
  restore("ALLOW_MOCK_WECOM_AUTH", original.allowMock);
  restore("ALLOW_STAGING_TEST_LOGIN", original.allowStagingTestLogin);
  restore("ALLOW_LEGACY_CREDENTIAL_TEST_AUTH", original.allowLegacyCredentialTest);
  restore("NEXT_PUBLIC_BASE_PATH", original.basePath);
  restore("BETTER_AUTH_URL", original.betterAuthUrl);
  restore("AUTH_TRUSTED_ORIGINS", original.trustedOrigins);
});

function configureStagingTestLogin() {
  process.env.NEXT_PUBLIC_APP_ENV = "staging";
  process.env.AUTH_PROVIDER = "mock-wecom";
  process.env.ALLOW_MOCK_WECOM_AUTH = "true";
  process.env.ALLOW_STAGING_TEST_LOGIN = "true";
  process.env.NEXT_PUBLIC_BASE_PATH = "/tool/projectai-staging";
  process.env.BETTER_AUTH_URL =
    "https://gridworks.cn/tool/projectai-staging/api/auth";
  process.env.AUTH_TRUSTED_ORIGINS = "https://gridworks.cn";
}

function stagingRequest(
  path = STAGING_TEST_LOGIN_PATH,
  headers: Record<string, string> = {},
) {
  return new Request(`https://gridworks.cn${path}`, {
    method: "POST",
    headers: {
      host: "gridworks.cn",
      origin: "https://gridworks.cn",
      "content-type": "application/json",
      "x-forwarded-host": "gridworks.cn",
      "x-forwarded-proto": "https",
      ...headers,
    },
    body: JSON.stringify({}),
  });
}

describe("Product V2 auth provider guard", () => {
  it("enables the fixed Staging test login only under the exact reviewed configuration", () => {
    configureStagingTestLogin();
    assert.deepEqual(getAuthProviderConfig(), {
      environment: "staging",
      provider: "mock-wecom",
      mockEnabled: true,
    });
    const publicConfig = publicAuthProvider();
    assert.equal(publicConfig.provider, "mock-wecom");
    assert.deepEqual(Object.keys(publicConfig).sort(), [
      "configured",
      "implemented",
      "provider",
      "stagingTestLoginEnabled",
    ]);
    assert.equal(publicConfig.implemented, true);
    assert.equal(publicConfig.stagingTestLoginEnabled, true);
    assert.deepEqual(validateStagingTestLoginRequest(stagingRequest()), {
      allowed: true,
    });
  });

  it("rejects wrong Host and Base Path for the Staging test login", () => {
    configureStagingTestLogin();
    assert.deepEqual(
      validateStagingTestLoginRequest(
        stagingRequest(STAGING_TEST_LOGIN_PATH, {
          host: "attacker.invalid",
          "x-forwarded-host": "attacker.invalid",
        }),
      ),
      { allowed: false, code: "STAGING_TEST_LOGIN_REQUEST_INVALID" },
    );
    assert.deepEqual(
      validateStagingTestLoginRequest(
        stagingRequest("/tool/projectai/api/auth/sign-in/staging-test"),
      ),
      { allowed: false, code: "STAGING_TEST_LOGIN_REQUEST_INVALID" },
    );
  });

  it("hard-rejects the Staging test-login flag and Mock WeCom in Production", async () => {
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    process.env.AUTH_PROVIDER = "wecom";
    process.env.ALLOW_MOCK_WECOM_AUTH = "false";
    process.env.ALLOW_STAGING_TEST_LOGIN = "true";
    assert.throws(
      () => publicAuthProvider(),
      /STAGING_TEST_LOGIN_PRODUCTION_FORBIDDEN/,
    );

    const response = await authPost(stagingRequest());
    assert.equal(response.status, 403);
    assert.equal(
      (await response.json() as { error: { code: string } }).error.code,
      "STAGING_TEST_LOGIN_DISABLED",
    );

    process.env.AUTH_PROVIDER = "mock-wecom";
    process.env.ALLOW_MOCK_WECOM_AUTH = "true";
    assert.throws(
      () => getAuthProviderConfig(),
      /MOCK_WECOM_AUTH_PRODUCTION_FORBIDDEN/,
    );
  });

  it("does not enable Staging test login without its dedicated flag", () => {
    configureStagingTestLogin();
    delete process.env.ALLOW_STAGING_TEST_LOGIN;
    assert.equal(publicAuthProvider().stagingTestLoginEnabled, false);
  });

  it("rejects Mock WeCom when its explicit flag is absent", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    process.env.AUTH_PROVIDER = "mock-wecom";
    delete process.env.ALLOW_MOCK_WECOM_AUTH;
    assert.throws(() => getAuthProviderConfig(), /MOCK_WECOM_AUTH_NOT_ENABLED/);
  });

  it("allows legacy credential auth only in an explicitly enabled test runtime", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.AUTH_PROVIDER = "legacy-credential-test";
    process.env.ALLOW_LEGACY_CREDENTIAL_TEST_AUTH = "true";
    assert.equal(getAuthProviderConfig().provider, "legacy-credential-test");

    delete process.env.ALLOW_LEGACY_CREDENTIAL_TEST_AUTH;
    assert.throws(() => getAuthProviderConfig(), /LEGACY_CREDENTIAL_AUTH_TEST_ONLY/);
  });

  it("rejects external, protocol-relative, login, and cross-base return targets", () => {
    for (const value of [
      "https://attacker.invalid/",
      "//attacker.invalid/",
      "/login?returnTo=/knowledge",
      "javascript:alert(1)",
      "/tool/not-projectai/knowledge",
    ]) {
      assert.equal(safeReturnTo(value), "/assistant");
    }
    assert.equal(safeReturnTo("/daily-report"), "/assistant");
    assert.equal(safeReturnTo("/assistant"), "/assistant");
    assert.equal(safeReturnTo("/data-spaces/projects/fictional/files"), "/data-spaces/projects/fictional/files");
    assert.equal(safeServerReturnTo("/daily-report"), "/assistant");
    assert.equal(safeServerReturnTo("/assistant"), "/assistant");
  });
});
