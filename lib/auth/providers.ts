import { z } from "zod";

export const productRoleSchema = z.enum(["super_admin", "admin", "member"]);
export type ProductRole = z.infer<typeof productRoleSchema>;

export const mockWeComIdentitySchema = z.enum([
  "super-admin",
  "admin",
  "member",
]);
export type MockWeComIdentityKey = z.infer<typeof mockWeComIdentitySchema>;

export type AuthenticatedIdentity = {
  providerId: "wecom" | "mock-wecom";
  providerSubject: string;
  displayName: string;
};

export interface AuthProvider {
  readonly id: AuthenticatedIdentity["providerId"];
  readonly kind: "oauth" | "mock";
}

const authEnvironmentSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
]);

const providerSchema = z.enum(["wecom", "mock-wecom", "legacy-credential-test"]);

export type AuthProviderConfig = {
  environment: z.infer<typeof authEnvironmentSchema>;
  provider: z.infer<typeof providerSchema>;
  mockEnabled: boolean;
};

function environment(): AuthProviderConfig["environment"] {
  const candidate = (process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development")
    .trim()
    .toLowerCase();
  const parsed = authEnvironmentSchema.safeParse(candidate);
  return parsed.success ? parsed.data : "development";
}

export function getAuthProviderConfig(): AuthProviderConfig {
  const currentEnvironment = environment();
  const configured = process.env.AUTH_PROVIDER?.trim().toLowerCase();
  const provider = providerSchema.parse(
    configured || (currentEnvironment === "test" ? "legacy-credential-test" : "wecom"),
  );
  const mockEnabled = process.env.ALLOW_MOCK_WECOM_AUTH === "true";

  if (currentEnvironment === "production" && (provider === "mock-wecom" || mockEnabled)) {
    throw new Error("MOCK_WECOM_AUTH_PRODUCTION_FORBIDDEN");
  }
  if (provider === "mock-wecom" && !mockEnabled) {
    throw new Error("MOCK_WECOM_AUTH_NOT_ENABLED");
  }
  if (
    provider === "legacy-credential-test" &&
    (currentEnvironment !== "test" || process.env.NODE_ENV !== "test")
  ) {
    throw new Error("LEGACY_CREDENTIAL_AUTH_TEST_ONLY");
  }

  return { environment: currentEnvironment, provider, mockEnabled };
}

export function isMockWeComAuthEnabled(): boolean {
  const config = getAuthProviderConfig();
  return (
    config.provider === "mock-wecom" &&
    config.mockEnabled &&
    config.environment !== "production"
  );
}

export function isLegacyCredentialAuthEnabled(): boolean {
  return getAuthProviderConfig().provider === "legacy-credential-test";
}

export const MOCK_WECOM_IDENTITIES: Readonly<
  Record<MockWeComIdentityKey, {
    userId: string;
    providerSubject: string;
    displayName: string;
    productRole: ProductRole;
  }>
> = {
  "super-admin": {
    userId: "kivisense-mock-super-admin",
    providerSubject: "mock:kivisense:super-admin",
    displayName: "Kivisense Super Admin",
    productRole: "super_admin",
  },
  admin: {
    userId: "kivisense-mock-admin",
    providerSubject: "mock:kivisense:admin",
    displayName: "Kivisense Admin",
    productRole: "admin",
  },
  member: {
    userId: "kivisense-mock-member",
    providerSubject: "mock:kivisense:member",
    displayName: "Kivisense Member",
    productRole: "member",
  },
};

export const weComAuthConfigurationSchema = z
  .object({
    corpId: z.string().trim().min(1),
    agentId: z.string().trim().regex(/^\d+$/),
    callbackUrl: z.string().url().refine((value) => value.startsWith("https://")),
    secretFile: z.string().trim().startsWith("/"),
  })
  .strict();

export type WeComAuthConfiguration = z.infer<typeof weComAuthConfigurationSchema>;

export function readWeComAuthConfiguration(): WeComAuthConfiguration {
  return weComAuthConfigurationSchema.parse({
    corpId: process.env.WECOM_CORP_ID,
    agentId: process.env.WECOM_AGENT_ID,
    callbackUrl: process.env.WECOM_AUTH_CALLBACK_URL,
    secretFile: process.env.WECOM_AUTH_SECRET_FILE,
  });
}

export class WeComAuthProvider implements AuthProvider {
  readonly id = "wecom" as const;
  readonly kind = "oauth" as const;

  constructor(readonly configuration: WeComAuthConfiguration = readWeComAuthConfiguration()) {}
}

export class MockWeComAuthProvider implements AuthProvider {
  readonly id = "mock-wecom" as const;
  readonly kind = "mock" as const;

  constructor() {
    if (!isMockWeComAuthEnabled()) throw new Error("MOCK_WECOM_AUTH_FORBIDDEN");
  }

  identity(key: MockWeComIdentityKey): AuthenticatedIdentity {
    const configured = MOCK_WECOM_IDENTITIES[key];
    return {
      providerId: this.id,
      providerSubject: configured.providerSubject,
      displayName: configured.displayName,
    };
  }
}

export function publicAuthProvider(): {
  provider: "wecom" | "mock-wecom";
  configured: boolean;
  implemented: boolean;
} {
  const config = getAuthProviderConfig();
  if (config.provider === "mock-wecom") {
    return {
      provider: "mock-wecom",
      configured: true,
      implemented: true,
    };
  }
  if (config.provider === "legacy-credential-test") {
    return { provider: "wecom", configured: false, implemented: false };
  }
  return {
    provider: "wecom",
    configured: weComAuthConfigurationSchema.safeParse({
      corpId: process.env.WECOM_CORP_ID,
      agentId: process.env.WECOM_AGENT_ID,
      callbackUrl: process.env.WECOM_AUTH_CALLBACK_URL,
      secretFile: process.env.WECOM_AUTH_SECRET_FILE,
    }).success,
    implemented: false,
  };
}
