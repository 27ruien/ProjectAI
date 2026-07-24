import { and, eq } from "drizzle-orm";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { account, user } from "@/lib/db/schema";
import {
  isMockWeComAuthEnabled,
  MOCK_WECOM_IDENTITIES,
  mockWeComIdentitySchema,
} from "./providers";

export function mockWeComAuthPlugin(): BetterAuthPlugin {
  return {
    id: "projectai-mock-wecom",
    endpoints: {
      signInMockWeCom: createAuthEndpoint(
        "/sign-in/mock-wecom",
        {
          method: "POST",
          body: z.object({
            identity: mockWeComIdentitySchema,
          }),
        },
        async (context) => {
          if (!isMockWeComAuthEnabled()) {
            return context.json(
              { error: { code: "MOCK_WECOM_AUTH_FORBIDDEN", message: "企业微信测试登录不可用" } },
              { status: 403 },
            );
          }

          const identity = MOCK_WECOM_IDENTITIES[context.body.identity];
          const [record] = await getDb()
            .select({ user })
            .from(account)
            .innerJoin(user, eq(user.id, account.userId))
            .where(
              and(
                eq(account.providerId, "mock-wecom"),
                eq(account.accountId, identity.providerSubject),
                eq(user.status, "active"),
                eq(user.productRole, identity.productRole),
              ),
            )
            .limit(1);
          if (!record) {
            return context.json(
              { error: { code: "MOCK_IDENTITY_NOT_PROVISIONED", message: "企业微信测试身份尚未配置" } },
              { status: 503 },
            );
          }

          const session = await context.context.internalAdapter.createSession(record.user.id);
          const authUser = { ...record.user, name: record.user.displayName };
          await setSessionCookie(context, { session, user: authUser });
          return context.json({ token: session.token, user: record.user });
        },
      ),
    },
  };
}
