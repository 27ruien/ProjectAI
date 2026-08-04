"use client";

import { useCallback, useState } from "react";
import { Button, Drawer, Group, HoverCard, Image, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { ExternalLink, FileSearch, Loader } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { ProjectAssistantCitationDto } from "@/types/project-assistant";

type CitationPreview = {
  citationId: string;
  sourceId: string;
  displayName: string;
  versionNumber: number;
  mimeType: string;
  sourceScope: string;
  sourceType: "project_document" | "company_document" | "conversation";
  documentVersionId: string | null;
  chunkId: string | null;
  pageNumber: number | null;
  slideNumber: number | null;
  sheetName: string | null;
  cellRange: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  locator: string;
  headingPath: string[];
  excerpt: string;
  thumbnailUrl: string | null;
};

export function AssistantCitationPreview({ citation, projectId, onOpenSource }: { citation: ProjectAssistantCitationDto; projectId: string | null; onOpenSource: () => void }) {
  const [preview, setPreview] = useState<CitationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [mobileOpened, setMobileOpened] = useState(false);
  const load = useCallback(async () => {
    if (preview || loading || unavailable) return;
    setLoading(true);
    try {
      const path = projectId
        ? `/api/projects/${encodeURIComponent(projectId)}/ai/citations/${encodeURIComponent(citation.id)}/preview`
        : `/api/ai/citations/${encodeURIComponent(citation.id)}/preview`;
      const response = await fetch(withBasePath(path), { credentials: "include", cache: "no-store" });
      const body = await response.json() as { citation?: CitationPreview };
      if (!response.ok || !body.citation) throw new Error("citation unavailable");
      setPreview(body.citation);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [citation.id, loading, preview, projectId, unavailable]);
  const sourceLabel = preview?.sourceType === "company_document" ? "公司资料" : preview?.sourceType === "conversation" ? "历史会话" : "项目资料";
  const content = (
    <Stack gap="sm" data-testid="assistant-citation-preview-content">
      {loading ? <Group gap="xs"><Loader size={14} /><Text size="xs" c="dimmed">正在核验引用权限…</Text></Group> : unavailable ? <Text size="xs" c="dimmed">该引用已不可访问或资料版本已变化。</Text> : preview ? <>
        <Stack gap={2}><Text size="sm" fw={700}>{preview.displayName}</Text><Text size="xs" c="dimmed">v{preview.versionNumber} · {sourceLabel} · {preview.locator}</Text></Stack>
        {preview.headingPath.length ? <Text size="xs" fw={600} c="projectBlue">{preview.headingPath.join(" / ")}</Text> : null}
        {preview.thumbnailUrl ? <Image src={preview.thumbnailUrl} alt={`${preview.displayName} 来源缩略图`} mah={180} radius="md" fit="cover" /> : null}
        <Paper withBorder p="sm" radius="md" bg="gray.0"><Text size="xs" fw={600} mb={4}>内容快照</Text><Text component="blockquote" size="xs" c="dimmed" m={0} pl="sm" bd="0 0 0 2px solid var(--mantine-color-projectBlue-2)">{preview.excerpt}</Text></Paper>
        <Button size="xs" variant="light" leftSection={<ExternalLink size={13} />} onClick={onOpenSource}>打开来源</Button>
      </> : <Text size="xs" c="dimmed">将鼠标停留在引用上即可核验来源。</Text>}
    </Stack>
  );
  return <>
    <HoverCard openDelay={180} width={360} shadow="md" onOpen={() => void load()}>
      <HoverCard.Target><UnstyledButton visibleFrom="sm" c="projectBlue" fz="xs" fw={600} data-testid="assistant-citation-hover-trigger"><Group gap={4}><FileSearch size={13} />预览引用</Group></UnstyledButton></HoverCard.Target>
      <HoverCard.Dropdown>{content}</HoverCard.Dropdown>
    </HoverCard>
    <UnstyledButton hiddenFrom="sm" c="projectBlue" fz="xs" fw={600} data-testid="assistant-citation-sheet-trigger" onClick={() => { setMobileOpened(true); void load(); }}><Group gap={4}><FileSearch size={13} />预览引用</Group></UnstyledButton>
    <Drawer opened={mobileOpened} onClose={() => setMobileOpened(false)} title="引用预览" position="bottom" size="70%"><Text size="xs" c="dimmed" mb="md">每次打开都会重新校验当前资料权限。</Text>{content}</Drawer>
  </>;
}
