import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getAuthProviderConfig,
  publicAuthProvider,
} from "../lib/auth/providers";

const original = {
  environment: process.env.NEXT_PUBLIC_APP_ENV,
  nodeEnvironment: process.env.NODE_ENV,
  provider: process.env.AUTH_PROVIDER,
  allowMock: process.env.ALLOW_MOCK_WECOM_AUTH,
  allowLegacyCredentialTest: process.env.ALLOW_LEGACY_CREDENTIAL_TEST_AUTH,
};

afterEach(() => {
  if (original.environment === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
  else process.env.NEXT_PUBLIC_APP_ENV = original.environment;
  if (original.nodeEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: original.nodeEnvironment });
  if (original.provider === undefined) delete process.env.AUTH_PROVIDER;
  else process.env.AUTH_PROVIDER = original.provider;
  if (original.allowMock === undefined) delete process.env.ALLOW_MOCK_WECOM_AUTH;
  else process.env.ALLOW_MOCK_WECOM_AUTH = original.allowMock;
  if (original.allowLegacyCredentialTest === undefined) {
    delete process.env.ALLOW_LEGACY_CREDENTIAL_TEST_AUTH;
  } else {
    process.env.ALLOW_LEGACY_CREDENTIAL_TEST_AUTH = original.allowLegacyCredentialTest;
  }
});

describe("Product V2 auth provider guard", () => {
  it("allows explicitly enabled Mock WeCom only outside Production", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    process.env.AUTH_PROVIDER = "mock-wecom";
    process.env.ALLOW_MOCK_WECOM_AUTH = "true";
    assert.deepEqual(getAuthProviderConfig(), {
      environment: "staging",
      provider: "mock-wecom",
      mockEnabled: true,
    });
    const publicConfig = publicAuthProvider();
    assert.equal(publicConfig.provider, "mock-wecom");
    assert.deepEqual(Object.keys(publicConfig).sort(), ["configured", "implemented", "provider"]);
    assert.equal(publicConfig.implemented, true);
  });

  it("rejects Mock WeCom and debug identity capability in Production", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    process.env.AUTH_PROVIDER = "mock-wecom";
    process.env.ALLOW_MOCK_WECOM_AUTH = "true";
    assert.throws(() => getAuthProviderConfig(), /MOCK_WECOM_AUTH_PRODUCTION_FORBIDDEN/);
  });

  it("rejects Mock WeCom when the explicit flag is absent", () => {
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

  it("rejects legacy credential auth outside test even when its CI flag is set", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    process.env.AUTH_PROVIDER = "legacy-credential-test";
    process.env.ALLOW_MOCK_WECOM_AUTH = "false";
    process.env.ALLOW_LEGACY_CREDENTIAL_TEST_AUTH = "true";
    assert.throws(() => getAuthProviderConfig(), /LEGACY_CREDENTIAL_AUTH_TEST_ONLY/);
  });
});
