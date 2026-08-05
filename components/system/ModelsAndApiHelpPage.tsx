import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleHelp } from "lucide-react";
import { Box, Button, Card, Group, SimpleGrid, Text, ThemeIcon, Title } from "@/components/ui/project-primitives";
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
    <Box component="main" maw={1120} mx="auto" px={{ base: "md", sm: "lg" }} py="xl">
      <Box component="header">
        <Text size="xs" fw={700} c="projectBlue.7">
          帮助中心
        </Text>
        <Title order={1} mt={4}>
          模型与 API 使用说明
        </Title>
        <Text maw={760} mt="sm" size="sm" lh={1.8} c="dimmed">
          管理员在这里完成 Provider、API Key、模型和业务场景配置。API Key
          只在保存时提交给服务端加密保存，不会显示在页面、审计或日志中；普通用户直接使用管理员配置的默认模型。
        </Text>
        <Button component={Link} href="/admin/models" mt="lg" rightSection={<ArrowRight size={16} />}>
          打开 Provider 与模型设置
        </Button>
      </Box>

      <Card withBorder radius="md" p="lg" mt="xl">
        <Group gap="xs">
          <CheckCircle2 size={17} color="var(--primary)" />
          <Text fw={650}>正确启用顺序</Text>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mt="md" spacing="sm">
          {steps.map((step, index) => (
            <Group key={step} align="center" gap="sm" p="sm" bg="projectBlue.0" style={{ borderRadius: "var(--radius)" }}>
              <ThemeIcon variant="filled" radius="xl" size="sm">
                {index + 1}
              </ThemeIcon>
              <Text size="sm">{step}</Text>
            </Group>
          ))}
        </SimpleGrid>
      </Card>

      <Card withBorder radius="md" p="lg" mt="md" bg="projectBlue.0">
        <Group gap="xs">
          <CircleHelp size={17} color="var(--primary)" />
          <Title order={2} size="h4">
            Model ID 到底是什么？
          </Title>
        </Group>
        <Text mt="sm" size="sm" lh={1.8} c="dimmed">
          Model ID 是服务商 API 使用的模型调用名称，例如 <code>qwen3.7-max</code>。
          它不是账号 ID、Provider ID 或 ProjectAI 数据库 ID。Provider 测试成功后，系统会自动读取可用模型；直接搜索并选择即可。只有服务商不提供模型列表时，才需要从其官方文档复制 Model ID。
        </Text>
      </Card>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mt="xl" spacing="md">
        {guides.map(({ title, description, image }) => (
          <Card key={image} withBorder radius="md" padding={0} style={{ overflow: "hidden" }}>
            <Image
              src={withBasePath(`/help/models-and-api/${image}.svg`)}
              unoptimized
              width={640}
              height={360}
              alt={`${title} 操作示意图`}
              style={{ display: "block", width: "100%", height: "auto" }}
            />
            <Box p="md">
              <Title order={2} size="h5">
                {title}
              </Title>
              <Text mt={6} size="xs" lh={1.7} c="dimmed">
                {description}
              </Text>
            </Box>
          </Card>
        ))}
      </SimpleGrid>
    </Box>
  );
}
