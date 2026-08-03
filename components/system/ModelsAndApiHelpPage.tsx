import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withBasePath } from "@/lib/base-path";

const guides = [
  {
    title: "1. 添加并测试 Provider",
    description:
      "填写服务商、HTTPS 地址、区域和 API Key，保存后点击“测试”。测试通过只代表连接正常，还需要点击“启用 Provider”。",
    image: "provider",
  },
  {
    title: "2. 替换 API Key",
    description:
      "在对应 Provider 行输入新 Key 并替换。旧 Key 不会回显；替换后要重新测试连接和相关模型。",
    image: "model",
  },
  {
    title: "3. 从发现结果选择模型",
    description:
      "测试连接后，页面会列出服务商返回的模型。直接搜索并点击 qwen3.7-max 等模型，不需要手抄 Model ID。",
    image: "default",
  },
  {
    title: "4. 测试并启用模型",
    description:
      "添加模型后先执行“测试 JSON”，确认结构化输出正常，再点击“启用模型”，最后绑定业务场景。",
    image: "conversation",
  },
  {
    title: "5. 资料与引用",
    description:
      "项目资料和公司资料先经过服务端权限校验，再作为回答引用返回；模型不能绕过资料权限。",
    image: "citation",
  },
  {
    title: "6. 需求概览",
    description:
      "需求概览按固定字段生成事实、推断和待确认项。模型结果只形成草稿，仍需人工确认。",
    image: "skill",
  },
  {
    title: "连接测试失败怎么看",
    description:
      "401 通常是 Key 无效；403 是权限不足；429 是额度或限流；5xx 或不可用表示服务商暂时异常。",
    image: "troubleshoot",
  },
] as const;

const steps = [
  "保存 Provider 和 API Key",
  "测试连接",
  "启用 Provider",
  "选择并添加文本模型",
  "测试 JSON 输出",
  "启用模型并绑定场景",
] as const;

export function ModelsAndApiHelpPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-7 px-5 py-7 sm:px-6 lg:px-8">
      <header>
        <p className="text-xs font-medium text-primary">帮助中心</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          模型与 API 使用说明
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          管理员在这里完成 Provider、API Key、模型和业务场景配置。API Key
          只在保存时提交给服务端加密保存，不会显示在页面、审计或日志中；普通用户直接使用管理员配置的默认模型。
        </p>
        <Button className="mt-4" asChild>
          <Link href="/admin/models">
            打开 Provider 与模型设置
            <ArrowRight />
          </Link>
        </Button>
      </header>

      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">正确启用顺序</h2>
        </div>
        <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step} className="flex items-center gap-3 rounded-lg bg-muted/40 p-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-center gap-2">
          <CircleHelp className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Model ID 到底是什么？</h2>
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Model ID 是服务商 API 使用的模型调用名称，例如
          <code className="mx-1 rounded bg-background px-1.5 py-0.5 text-foreground">
            qwen3.7-max
          </code>
          。它不是账号 ID、Provider ID 或 ProjectAI 数据库 ID。Provider
          测试成功后，系统会自动读取可用模型；直接搜索并选择即可。只有服务商不提供模型列表时，才需要从其官方文档复制 Model ID。
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {guides.map(({ title, description, image }) => (
          <article key={image} className="overflow-hidden rounded-lg border bg-card">
            <Image
              src={withBasePath(`/help/models-and-api/${image}.svg`)}
              width={640}
              height={360}
              alt={`${title} 操作示意图`}
              className="h-auto w-full border-b"
            />
            <div className="p-4">
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {description}
              </p>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
