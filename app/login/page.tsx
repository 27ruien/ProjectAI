import type { Metadata } from "next";
import { LoginPage } from "@/components/auth";

export const metadata: Metadata = {
  title: "登录",
  description: "登录 Project AI OS 企业工作台",
};

type LoginRouteProps = {
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

export default async function LoginRoute({ searchParams }: LoginRouteProps) {
  const params = await searchParams;
  const initialReturnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  return <LoginPage initialReturnTo={initialReturnTo} />;
}
