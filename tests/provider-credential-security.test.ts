import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { afterEach, describe, it } from "node:test";
import { encryptProviderApiKey, maskProviderApiKey } from "@/lib/ai/provider-credentials";
import { QwenProjectAssistantProvider } from "@/lib/ai/project-assistant/qwen-provider";

const original = {
  environment: process.env.NEXT_PUBLIC_APP_ENV,
  credentialKey: process.env.AI_PROVIDER_CREDENTIALS_KEY,
  credentialKeyFile: process.env.AI_PROVIDER_CREDENTIALS_KEY_FILE,
};

afterEach(() => {
  if (original.environment === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
  else process.env.NEXT_PUBLIC_APP_ENV = original.environment;
  if (original.credentialKey === undefined) delete process.env.AI_PROVIDER_CREDENTIALS_KEY;
  else process.env.AI_PROVIDER_CREDENTIALS_KEY = original.credentialKey;
  if (original.credentialKeyFile === undefined) delete process.env.AI_PROVIDER_CREDENTIALS_KEY_FILE;
  else process.env.AI_PROVIDER_CREDENTIALS_KEY_FILE = original.credentialKeyFile;
});

describe("provider credential security", () => {
  it("encrypts a submitted key without retaining its plaintext in the record", async () => {
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.AI_PROVIDER_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.AI_PROVIDER_CREDENTIALS_KEY_FILE = "/not-a-real-provider-key-file";
    const raw = "fixture-provider-key-1234";
    const encrypted = await encryptProviderApiKey(raw);
    assert.notEqual(encrypted.ciphertext, raw);
    assert.equal(encrypted.apiKeyLast4, "1234");
    assert.equal(maskProviderApiKey(encrypted.apiKeyLast4), "****1234");
    assert.equal(maskProviderApiKey(null), null);
  });

  it("does not send a thinking extension when a model profile forbids it", async () => {
    let payload: Record<string, unknown> | null = null;
    const provider = new QwenProjectAssistantProvider(
      "https://example.invalid/v1",
      async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          model: "fixture-model",
          choices: [{ message: { content: "{\"ok\":true}" } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      async () => "fixture-provider-key-1234",
    );
    await provider.generate({
      model: "fixture-model",
      systemPrompt: "Return JSON.",
      userPrompt: "Return JSON.",
      purpose: "probe",
      responseFormat: "json_object",
      disableThinkingForJson: false,
      timeoutMs: 1_000,
      temperature: 0,
      maxOutputTokens: 64,
    });
    assert.ok(payload);
    const captured = payload as unknown as Record<string, unknown>;
    assert.deepEqual(captured.response_format, { type: "json_object" });
    assert.equal(Object.hasOwn(captured, "enable_thinking"), false);
  });
});
