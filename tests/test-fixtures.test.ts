import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  fixtureCleanupContextFromHeaders,
  fixtureContextFromHeaders,
} from "../lib/test-fixtures/service";

const originalEnvironment = process.env.NEXT_PUBLIC_APP_ENV;

afterEach(() => {
  if (originalEnvironment === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
  else process.env.NEXT_PUBLIC_APP_ENV = originalEnvironment;
});

function headers(expiresAt: Date): Headers {
  return new Headers({
    "x-projectai-fixture-run-id": "uat-fixture-cleanup-contract",
    "x-projectai-fixture-expires-at": expiresAt.toISOString(),
  });
}

describe("test fixture lifecycle boundary", () => {
  it("accepts only future registrations but permits exact expired cleanup metadata", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    const active = headers(new Date(Date.now() + 60_000));
    const expired = headers(new Date(Date.now() - 60_000));
    assert.ok(fixtureContextFromHeaders(active));
    assert.ok(fixtureCleanupContextFromHeaders(active));
    assert.equal(fixtureContextFromHeaders(expired), null);
    assert.ok(fixtureCleanupContextFromHeaders(expired));
  });

  it("rejects registration and cleanup metadata in Production", () => {
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    const input = headers(new Date(Date.now() + 60_000));
    assert.equal(fixtureContextFromHeaders(input), null);
    assert.equal(fixtureCleanupContextFromHeaders(input), null);
  });
});
