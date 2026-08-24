import type { Metadata } from "next";
import { LoginPage } from "@/components/auth";
import { publicAuthProvider } from "@/lib/auth/providers";

export const metadata: Metadata = {
  title: "登录",
  description: "登录 Project AI 项目知识工具",
};

type LoginRouteProps = {
  searchParams: Promise<{
    returnTo?: string | string[];
  }>;
};

export default async function LoginRoute({ searchParams }: LoginRouteProps) {
  const params = await searchParams;
  const initialReturnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const authProvider = publicAuthProvider();
  return (
    <LoginPage
      initialReturnTo={initialReturnTo}
      provider={authProvider.provider}
      providerConfigured={authProvider.configured}
      providerImplemented={authProvider.implemented}
      stagingTestLoginEnabled={authProvider.stagingTestLoginEnabled}
      credentialLoginEnabled={authProvider.credentialLoginEnabled}
    />
  );
}
