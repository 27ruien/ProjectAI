import Image from "next/image";

const guides = [
  ["新增 Provider", "在管理设置中填写名称和区域；密钥只保存在受保护的服务端配置中。", "provider"],
  ["新增模型", "选择已启用的 Provider，再填写模型标识和能力。", "model"],
  ["设置默认模型", "为聊天、资料问答和需求概览分别指定已经验证通过的模型。", "default"],
  ["选择会话模型", "只有超级管理员可以在单个会话中临时改用已验证模型。", "conversation"],
  ["资料与引用", "项目和公司资料始终先经过权限校验，再作为回答引用返回。", "citation"],
  ["需求概览", "Skill 依据固定模板填充事实、推断和待确认事项，而不是自由重排文档。", "skill"],
  ["常见问题", "模型不可用时，输入和会话会保留；请检查 Provider、区域和模型权限。", "troubleshoot"],
] as const;

export function ModelsAndApiHelpPage() {
  return <main className="mx-auto max-w-5xl space-y-7 px-5 py-7 sm:px-6 lg:px-8">
    <header><p className="text-xs font-medium text-primary">帮助中心</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">模型与 API 使用说明</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">这里说明管理员如何安全管理 AI Provider、模型和场景。普通用户不需要配置模型，直接向 AI 助手提问即可。</p></header>
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{guides.map(([title, description, image]) => <article key={image} className="overflow-hidden rounded-lg border bg-card"><Image src={`/help/models-and-api/${image}.svg`} width={640} height={360} alt={`${title} 示意图`} className="h-auto w-full border-b" /><div className="p-4"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div></article>)}</section>
  </main>;
}
