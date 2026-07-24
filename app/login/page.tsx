import type { Metadata } from "next";
import { LoginPage } from "@/components/auth";
import { publicAuthProvider } from "@/lib/auth/providers";

export const metadata: Metadata = {
  title: "登录",
  description: "登录 Project AI OS 企业工作台",
};

type LoginRouteProps = {
  searchParams: Promise<{
    returnTo?: string | string[];
    debug?: string | string[];
  }>;
};

export default async function LoginRoute({ searchParams }: LoginRouteProps) {
  const params = await searchParams;
  const initialReturnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const debug = Array.isArray(params.debug) ? params.debug[0] : params.debug;
  const authProvider = publicAuthProvider();
  return (
    <LoginPage
      initialReturnTo={initialReturnTo}
      provider={authProvider.provider}
      providerConfigured={authProvider.configured}
      providerImplemented={authProvider.implemented}
      debugIdentityEnabled={authProvider.debugIdentityEnabled}
      debugAdminRequested={debug === "admin"}
    />
  );
}
