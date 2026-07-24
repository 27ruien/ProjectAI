"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Building2,
  LoaderCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import { APP_RUNTIME } from "@/config/app-runtime";
import {
  navigateToAppPath,
  safeReturnTo,
  signInWithMockWeCom,
} from "./auth-client";

type MockIdentity = "super-admin" | "admin" | "member";

type LoginPageProps = {
  initialReturnTo?: string;
  provider: "wecom" | "mock-wecom";
  providerConfigured: boolean;
  providerImplemented: boolean;
  debugAdminRequested?: boolean;
};

const identities: Array<{
  key: MockIdentity;
  label: string;
  detail: string;
  icon: typeof ShieldCheck;
}> = [
  {
    key: "super-admin",
    label: "Kivisense Super Admin",
    detail: "组织架构与全部知识库",
    icon: ShieldCheck,
  },
  {
    key: "admin",
    label: "Kivisense Admin",
    detail: "全部知识库与 AI 工作流",
    icon: Building2,
  },
  {
    key: "member",
    label: "Kivisense Member",
    detail: "部门与受邀项目空间",
    icon: Users,
  },
];

export function LoginPage({
  initialReturnTo,
  provider,
  providerConfigured,
  providerImplemented,
  debugAdminRequested = false,
}: LoginPageProps) {
  const returnTo = safeReturnTo(initialReturnTo);
  const [submitting, setSubmitting] = useState<MockIdentity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debugAttempted = useRef(false);

  const signIn = useCallback(async (identity: MockIdentity) => {
    if (submitting) return;
    setSubmitting(identity);
    setError(null);
    try {
      await signInWithMockWeCom({ identity, returnTo });
      navigateToAppPath(returnTo);
    } catch {
      setSubmitting(null);
      setError("企业微信测试身份登录失败，请确认 Mock Provider 已启用并完成身份 Seed。" );
    }
  }, [returnTo, submitting]);

  useEffect(() => {
    if (
      debugAdminRequested &&
      provider === "mock-wecom" &&
      !debugAttempted.current
    ) {
      debugAttempted.current = true;
      void signIn("admin");
    }
  }, [debugAdminRequested, provider, signIn]);

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.06fr)_minmax(460px,0.94fr)]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="absolute -left-32 top-1/3 size-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-80 rounded-full bg-[#3a7b77]/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-white">
            <Bot className="size-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.02em]">Project AI OS</span>
        </div>
        <div className="relative my-auto max-w-xl py-16">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs text-[#b9b9c8]">
            <ShieldCheck className="size-3.5 text-[#a9a2ff]" aria-hidden="true" />
            Kivisense Knowledge Workspace
          </p>
          <h1 className="max-w-lg text-4xl font-semibold leading-[1.18] tracking-[-0.035em] text-white">
            用企业身份进入可信的知识与 AI 工作流。
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[#aaaaba]">
            企业微信只负责身份认证；角色、部门、知识空间和项目权限始终由 ProjectAI 服务端校验。
          </p>
        </div>
        <p className="relative text-xs text-[#868797]">
          {APP_RUNTIME.environment.toUpperCase()} · {APP_RUNTIME.version} · {APP_RUNTIME.shortCommitSha}
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-7">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">Enterprise identity</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-foreground">
              {provider === "mock-wecom" ? "企业微信测试登录" : "企业微信登录"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {provider === "mock-wecom"
                ? "仅限 Local / Staging 的虚构身份，不需要账号或密码。"
                : "正式环境将通过企业微信 OAuth / 扫码完成身份认证。"}
            </p>
          </div>

          {provider === "mock-wecom" ? (
            <div className="space-y-3" aria-label="企业微信测试身份">
              {identities.map((identity) => {
                const Icon = identity.icon;
                const busy = submitting === identity.key;
                return (
                  <button
                    key={identity.key}
                    type="button"
                    disabled={Boolean(submitting)}
                    onClick={() => void signIn(identity.key)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.025] disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      {busy ? <LoaderCircle className="size-5 animate-spin" /> : <Icon className="size-5" />}
                    </span>
                    <span className="min-w-0">
                      <strong className="block text-sm font-semibold text-foreground">{identity.label}</strong>
                      <small className="mt-0.5 block text-xs text-muted-foreground">{identity.detail}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <button
              type="button"
              disabled={!providerConfigured || !providerImplemented}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-55"
              title={!providerConfigured ? "企业微信 OAuth 配置尚未提供" : !providerImplemented ? "等待企业微信 API 后接入 OAuth 适配器" : undefined}
            >
              <Building2 className="size-4" />
              {!providerConfigured ? "等待企业微信 OAuth 配置" : !providerImplemented ? "配置已验证，等待 OAuth 适配器" : "使用企业微信扫码登录"}
            </button>
          )}

          {debugAdminRequested && provider !== "mock-wecom" ? (
            <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive-soft px-3.5 py-3 text-sm text-destructive">
              debug=admin 只允许在显式启用 Mock WeCom 的 Local / Staging 环境使用。
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive-soft px-3.5 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <p className="mt-7 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
            登录状态保存在服务端并通过 HttpOnly Cookie 传递；URL 中不保存身份、凭据或会话 Token。
          </p>
        </div>
      </section>
    </main>
  );
}
