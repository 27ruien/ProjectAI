import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProviderCanBeEnabled } from "@/lib/ai/model-management";

describe("managed Provider activation", () => {
  it("allows a disabled Provider to enter the enabled state after a passed test", () => {
    assert.doesNotThrow(() =>
      assertProviderCanBeEnabled({
        credentialMode: "managed",
        lastTestStatus: "passed",
      }),
    );
  });

  it("rejects activation before a managed Provider passes its connection test", () => {
    assert.throws(
      () =>
        assertProviderCanBeEnabled({
          credentialMode: "managed",
          lastTestStatus: "failed",
        }),
      /Provider 需要先通过连接测试/,
    );
  });

  it("keeps deployment-secret Providers compatible with their existing activation flow", () => {
    assert.doesNotThrow(() =>
      assertProviderCanBeEnabled({
        credentialMode: "environment",
        lastTestStatus: "not_tested",
      }),
    );
  });
});
