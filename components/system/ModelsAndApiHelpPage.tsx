import Image from "next/image";

const guides = [
  ["新增 Provider", "进入管理设置 → Provider 与模型，填写 HTTPS 地址、区域和 API Key。保存后 Key 不会再次显示。", "provider"],
  ["替换 API Key", "打开对应 Provider，输入新 Key 后保存，再执行 Provider 和模型测试；留空不会覆盖原 Key。", "model"],
  ["新增 qwen3.7-max", "手动填写 Model ID、JSON 与 Thinking 能力，先测试结构化输出，测试通过后才能启用。", "default"],
  ["选择会话模型", "只有超级管理员可以在单个会话中临时改用已验证模型。", "conversation"],
  ["资料与引用", "项目和公司资料始终先经过权限校验，再作为回答引用返回。", "citation"],
  ["需求概览", "Skill 依据固定模板填充事实、推断和待确认事项，而不是自由重排文档。", "skill"],
  ["403 与 429", "403 表示 Key 缺少资源或模型权限；429 才表示额度、限流、并发或计费状态问题。", "troubleshoot"],
] as const;

export function ModelsAndApiHelpPage() {
  return <main className="mx-auto max-w-5xl space-y-7 px-5 py-7 sm:px-6 lg:px-8">
    <header><p className="text-xs font-medium text-primary">帮助中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">模型与 API 使用说明</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">系统管理员和组织管理员可以在管理设置 → Provider 与模型中添加 Provider、替换 API Key、测试模型并绑定业务场景。API Key 只在保存时提交给服务端加密保存，不会显示在页面、审计或日志中。普通用户直接使用管理员配置的默认模型。</p></header>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{guides.map(([title, description, image]) => <article key={image} className="overflow-hidden rounded-lg border bg-card"><Image src={`/help/models-and-api/${image}.svg`} width={640} height={360} alt={`${title} 示意图`} className="h-auto w-full border-b" /><div className="p-4"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div></article>)}</section>
  </main>;
}
