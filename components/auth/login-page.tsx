"use client";

import {
  type FormEvent,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Building2,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import {
  navigateToAppPath,
  safeReturnTo,
  signInWithEmail,
  signInToStagingTestEnvironment,
  signInWithMockWeCom,
} from "./auth-client";

type MockIdentity = "super-admin" | "admin" | "member";

type LoginPageProps = {
  initialReturnTo?: string;
  provider: "wecom" | "mock-wecom";
  providerConfigured: boolean;
  providerImplemented: boolean;
  stagingTestLoginEnabled: boolean;
  credentialLoginEnabled: boolean;
};

const identities: Array<{
  key: MockIdentity;
  label: string;
  detail: string;
  icon: typeof ShieldCheck;
}> = [
  {
    key: "super-admin",
    label: "Kivisense 超级管理员",
    detail: "组织架构与全部知识库",
    icon: ShieldCheck,
  },
  {
    key: "admin",
    label: "Kivisense 管理员",
    detail: "全部知识库与 AI 工作流",
    icon: Building2,
  },
  {
    key: "member",
    label: "Kivisense 成员",
    detail: "部门与受邀项目空间",
    icon: Users,
  },
];

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function LoginPage({
  initialReturnTo,
  provider,
  providerConfigured,
  providerImplemented,
  stagingTestLoginEnabled,
  credentialLoginEnabled,
}: LoginPageProps) {
  const hydrated = useHydrated();
  const returnTo = safeReturnTo(initialReturnTo);
  const [submitting, setSubmitting] = useState<
    MockIdentity | "staging" | "credential" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

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

  const enterStaging = useCallback(async () => {
    if (submitting) return;
    setSubmitting("staging");
    setError(null);
    try {
      await signInToStagingTestEnvironment();
      navigateToAppPath(returnTo);
    } catch {
      setSubmitting(null);
      setError("Staging 测试登录失败，请确认受控测试身份与环境配置可用。");
    }
  }, [returnTo, submitting]);

  const signInWithCredential = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting("credential");
    setError(null);
    try {
      await signInWithEmail({ email, password });
      navigateToAppPath(returnTo);
    } catch {
      setSubmitting(null);
      setError("邮箱或密码错误，请检查测试账号信息后重试。");
    }
  }, [email, password, returnTo, submitting]);

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.06fr)_minmax(460px,0.94fr)]">
      <section className="hidden border-r bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg border bg-background text-primary">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.02em]">Project AI</span>
        </div>
        <div className="my-auto max-w-xl py-16">
          <h1 className="max-w-lg text-4xl font-semibold leading-[1.18] tracking-[-0.035em] text-sidebar-foreground">
            项目资料、成员与可信答案，<br />始终清晰，随时可用。
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-sidebar-foreground/60">
            在同一个工作空间中管理项目资料、协作成员，并获得有来源依据的回答。
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/40">Project AI</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-7">
            {credentialLoginEnabled ? <p className="mb-2 text-[11px] font-medium tracking-[0.14em] text-muted-foreground">UAT 测试环境</p> : null}
            <h2 className="text-2xl font-semibold leading-8 tracking-[-0.025em] text-foreground">
              {credentialLoginEnabled
                ? "登录"
                : provider === "mock-wecom"
                  ? "企业微信测试登录"
                  : "企业微信登录"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {credentialLoginEnabled
                ? "请使用单独提供的 UAT 测试账号。"
                : provider === "mock-wecom"
                  ? "仅限 Local / Staging 的虚构身份，不需要账号或密码。"
                  : "正式环境将通过企业微信 OAuth / 扫码完成身份认证。"}
            </p>
          </div>

          {stagingTestLoginEnabled ? (
            <div className="mb-5 rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
              <p className="text-xs font-medium text-muted-foreground">
                仅用于 Staging 产品验收
              </p>
              <button
                type="button"
                disabled={!hydrated || Boolean(submitting)}
                onClick={() => void enterStaging()}
                className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60"
              >
                {submitting === "staging" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                进入测试环境
              </button>
            </div>
          ) : null}

          {credentialLoginEnabled ? (
            <form className="space-y-4" onSubmit={(event) => void signInWithCredential(event)}>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground" htmlFor="email">
                  邮箱
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.currentTarget.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary"
                  placeholder="name@test.local"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground" htmlFor="password">
                  密码
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={!hydrated || Boolean(submitting) || !email || !password}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-wait disabled:opacity-60"
              >
                {submitting === "credential" ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                登录
              </button>
            </form>
          ) : provider === "mock-wecom" ? (
            <div className="space-y-3" aria-label="企业微信测试身份">
              {identities.map((identity) => {
                const Icon = identity.icon;
                const busy = submitting === identity.key;
                return (
                  <button
                    key={identity.key}
                    type="button"
                    disabled={!hydrated || Boolean(submitting)}
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
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-55"
              title={!providerConfigured ? "企业微信 OAuth 配置尚未提供" : !providerImplemented ? "等待企业微信 API 后接入 OAuth 适配器" : undefined}
            >
              <Building2 className="size-4" />
              {!providerConfigured ? "等待企业微信 OAuth 配置" : !providerImplemented ? "配置已验证，等待 OAuth 适配器" : "使用企业微信扫码登录"}
            </button>
          )}

          {error ? (
            <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive-soft px-3.5 py-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

        </div>
      </section>
    </main>
  );
}
