"use client";

import { useCallback, useState } from "react";
import { Button, Drawer, Group, HoverCard, Loader, Paper, Stack, Text, UnstyledButton } from "@/components/ui/project-primitives";
import { ExternalLink, History } from "lucide-react";
import { withBasePath } from "@/lib/base-path";

type HistoryPreview = { title: string; updatedAt: string; excerpt: string };

export function AssistantHistoryCitationPreview({ projectId, threadId, onOpen }: { projectId: string | null; threadId: string; onOpen: () => void }) {
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [mobileOpened, setMobileOpened] = useState(false);
  const load = useCallback(async () => {
    if (preview || loading || unavailable) return;
    setLoading(true);
    try {
      const path = projectId
        ? `/api/projects/${encodeURIComponent(projectId)}/ai/history/${encodeURIComponent(threadId)}/preview`
        : `/api/ai/history/${encodeURIComponent(threadId)}/preview`;
      const response = await fetch(withBasePath(path), { credentials: "include", cache: "no-store" });
      const body = await response.json() as { history?: HistoryPreview };
      if (!response.ok || !body.history) throw new Error("history unavailable");
      setPreview(body.history);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [loading, preview, projectId, threadId, unavailable]);
  const content = <Stack gap="sm" data-testid="assistant-history-preview-content">{loading ? <Group gap="xs"><Loader size={14} /><Text size="xs" c="dimmed">正在核验历史会话权限…</Text></Group> : unavailable ? <Text size="xs" c="dimmed">该历史会话已不可访问。</Text> : preview ? <><Stack gap={2}><Text size="sm" fw={700}>{preview.title}</Text><Text size="xs" c="dimmed">{new Date(preview.updatedAt).toLocaleDateString("zh-CN")} · 历史对话</Text></Stack><Paper withBorder p="sm" bg="gray.0"><Text size="xs" fw={600} mb={4}>相关消息摘录</Text><Text component="blockquote" size="xs" c="dimmed" m={0} pl="sm" bd="0 0 0 2px solid color-mix(in oklch, var(--primary), transparent 70%)">{preview.excerpt}</Text></Paper><Button size="xs" variant="light" leftSection={<ExternalLink size={13} />} onClick={onOpen}>打开会话</Button></> : <Text size="xs" c="dimmed">将鼠标停留在历史会话上即可查看摘录。</Text>}</Stack>;
  return <>
    <HoverCard openDelay={180} width={340} shadow="md" onOpen={() => void load()}><HoverCard.Target><UnstyledButton visibleFrom="sm" c="projectBlue" fz="xs" data-testid="assistant-history-hover-trigger"><Group gap={4}><History size={13} />历史会话</Group></UnstyledButton></HoverCard.Target><HoverCard.Dropdown>{content}</HoverCard.Dropdown></HoverCard>
    <UnstyledButton hiddenFrom="sm" c="projectBlue" fz="xs" data-testid="assistant-history-sheet-trigger" onClick={() => { setMobileOpened(true); void load(); }}><Group gap={4}><History size={13} />历史会话</Group></UnstyledButton>
    <Drawer opened={mobileOpened} onClose={() => setMobileOpened(false)} title="历史会话引用" position="bottom" size="60%"><Text size="xs" c="dimmed" mb="md">打开前会重新核验当前会话和资料权限。</Text>{content}</Drawer>
  </>;
}
