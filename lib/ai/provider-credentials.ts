import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import { aiProviderCredential, aiProviderProfile } from "@/lib/db/schema";
import { ProjectAssistantError } from "./project-assistant/errors";
import { readQwenApiKey } from "./project-assistant/secrets";

const ALGORITHM = "aes-256-gcm";
const KEY_FILE = "/run/secrets/provider_credentials_key";
const AAD = Buffer.from("projectai/provider-credential/v1", "utf8");

type Ciphertext = {
  ciphertext: string;
  iv: string;
  authTag: string;
  apiKeyLast4: string;
};

function providerSecretError(): ProjectAssistantError {
  return new ProjectAssistantError(
    503,
    "PROVIDER_SECRET_MISSING",
    "Provider 凭据加密服务未配置",
  );
}

async function encryptionKey(): Promise<Buffer> {
  const configuredFile = process.env.AI_PROVIDER_CREDENTIALS_KEY_FILE?.trim() || KEY_FILE;
  let encoded = "";
  try {
    encoded = (await readFile(configuredFile, "utf8")).trim();
  } catch {
    const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || "development";
    if (environment === "staging" || environment === "production") throw providerSecretError();
    encoded = process.env.AI_PROVIDER_CREDENTIALS_KEY?.trim() || "";
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw providerSecretError();
  return key;
}

export async function encryptProviderApiKey(value: string): Promise<Ciphertext> {
  const apiKey = value.trim();
  if (apiKey.length < 8 || apiKey.length > 2_048 || /[\r\n]/.test(apiKey)) {
    throw new ProjectAssistantError(400, "MODEL_REQUEST_INVALID", "API Key 格式无效");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, await encryptionKey(), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    apiKeyLast4: apiKey.slice(-4),
  };
}

async function decryptProviderApiKey(value: Pick<Ciphertext, "ciphertext" | "iv" | "authTag">): Promise<string> {
  try {
    const decipher = createDecipheriv(ALGORITHM, await encryptionKey(), Buffer.from(value.iv, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new ProjectAssistantError(503, "PROVIDER_SECRET_MISSING", "Provider 凭据无法安全读取");
  }
}

export async function resolveProviderApiKey(
  providerId: string,
  db: DatabaseExecutor = getDb(),
): Promise<string> {
  const [provider] = await db
    .select({ id: aiProviderProfile.id, credentialMode: aiProviderProfile.credentialMode })
    .from(aiProviderProfile)
    .where(eq(aiProviderProfile.id, providerId))
    .limit(1);
  if (!provider) throw new ProjectAssistantError(404, "AI_CONFIGURATION_INVALID", "Provider 不存在");
  if (provider.credentialMode === "environment") return readQwenApiKey();
  const [credential] = await db
    .select({ ciphertext: aiProviderCredential.ciphertext, iv: aiProviderCredential.iv, authTag: aiProviderCredential.authTag })
    .from(aiProviderCredential)
    .where(eq(aiProviderCredential.providerProfileId, providerId))
    .limit(1);
  if (!credential) throw providerSecretError();
  return decryptProviderApiKey(credential);
}

export function maskProviderApiKey(last4: string | null | undefined): string | null {
  return last4 && /^[\s\S]{4}$/.test(last4) ? `****${last4}` : null;
}
