"use client";

import { useState, type FormEvent } from "react";
import {
  Bot,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { APP_RUNTIME } from "@/config/app-runtime";
import { navigateToAppPath, safeReturnTo, signInWithEmail } from "./auth-client";

const GENERIC_LOGIN_ERROR = "邮箱或密码不正确，请检查后重试。";

export function LoginPage({ initialReturnTo }: { initialReturnTo?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const returnTo = safeReturnTo(initialReturnTo);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      await signInWithEmail({ email, password, returnTo });
      navigateToAppPath(returnTo);
    } catch {
      setError(GENERIC_LOGIN_ERROR);
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.06fr)_minmax(460px,0.94fr)]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="absolute -left-32 top-1/3 size-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -right-24 bottom-0 size-80 rounded-full bg-[#3a7b77]/15 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/16%)]">
            <Bot className="size-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-[-0.02em]">Project AI OS</span>
        </div>

        <div className="relative my-auto max-w-xl py-16">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs text-[#b9b9c8]">
            <ShieldCheck className="size-3.5 text-[#a9a2ff]" aria-hidden="true" />
            Identity and Project Isolation
          </p>
          <h1 className="max-w-lg text-4xl font-semibold leading-[1.18] tracking-[-0.035em] text-white">
            在可信的项目边界内，推进每一次交付。
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-[#aaaaba]">
            身份、Session 与项目成员关系均由服务端校验。你只会看到被授权的项目，所有关键操作都保留审计边界。
          </p>
          <div className="mt-10 grid max-w-lg gap-3 sm:grid-cols-2">
            <SecurityFact icon={LockKeyhole} title="安全 Session" detail="凭据仅在服务端验证" />
            <SecurityFact icon={KeyRound} title="项目级授权" detail="每次读取与写入都校验" />
          </div>
        </div>

        <p className="relative text-xs text-[#868797]">
          {APP_RUNTIME.environment.toUpperCase()} · {APP_RUNTIME.version} · {APP_RUNTIME.shortCommitSha}
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-9 place-items-center rounded-[10px] bg-primary text-white"><Bot className="size-[18px]" /></span>
            <span className="font-semibold tracking-[-0.02em] text-foreground">Project AI OS</span>
          </div>
          <div className="mb-7">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">Welcome back</p>
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-foreground">登录工作台</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">使用管理员为你预创建的企业账号继续。</p>
          </div>

          <form onSubmit={submit} className="space-y-5" noValidate>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">邮箱</span>
              <input
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                required
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={error ? "login-error" : undefined}
                className="h-11 w-full rounded-lg border border-input bg-card px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                placeholder="name@company.com"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-foreground">密码</span>
              <span className="relative block">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={error ? "login-error" : undefined}
                  className="h-11 w-full rounded-lg border border-input bg-card px-3.5 pr-11 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                  placeholder="输入密码"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>

            {error ? (
              <div id="login-error" role="alert" className="rounded-lg border border-destructive/20 bg-destructive-soft px-3.5 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting || !email.trim() || !password}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-55"
            >
              {submitting ? <><LoaderCircle className="size-4 animate-spin" />正在登录</> : "登录"}
            </button>
          </form>

          <div className="mt-7 border-t border-border pt-5">
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              登录失败不会透露账号是否存在。若需要开通或停用账号，请联系系统管理员。
            </p>
            <p className="mt-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground lg:hidden">
              {APP_RUNTIME.environment} · {APP_RUNTIME.version} · {APP_RUNTIME.shortCommitSha}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function SecurityFact({ icon: Icon, title, detail }: { icon: typeof LockKeyhole; title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <Icon className="size-4 text-[#a9a2ff]" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-xs text-[#8f91a2]">{detail}</p>
    </div>
  );
}
