"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  Paper,
  Radio,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from "@/components/ui/project-primitives";
import { useDisclosure } from "@/components/ui/project-hooks";
import {
  CheckCircle2,
  Download,
  FileText,
  GitCompareArrows,
  PencilLine,
  RefreshCw,
  Save,
  Scale,
  Sparkles,
} from "lucide-react";
import { withBasePath } from "@/lib/base-path";

type Item = {
  id: string;
  label: string;
  status: string;
  value: string;
  citationLabels: string[];
};

type Question = {
  id: string;
  group: string;
  prompt: string;
  required: boolean;
  answer: string;
  status: "pending" | "answered" | "not_applicable";
  citationLabels: string[];
};

type Candidate = {
  id: string;
  candidateOrder: number;
  generationModelId: string;
  modelDisplayName: string;
  providerName: string;
  actualModel: string | null;
  status: "running" | "ready" | "failed";
  items: Item[];
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  failureCode: string | null;
  createdAt: string;
};

type ComparisonRun = {
  id: string;
  status: "running" | "ready" | "failed" | "selected";
  sourceDigest: string;
  promptVersion: string;
  temperatureMilli: number;
  maxOutputTokens: number;
  citationCount: number;
  selectedCandidateId: string | null;
  candidates: Candidate[];
};

type ModelOption = {
  id: string;
  displayName: string;
  modelId: string;
  isDefault: boolean;
  lastTestStatus: string;
};

type ModelOptions = {
  defaultModel: ModelOption;
  alternatives: ModelOption[];
  canCompare: boolean;
  canSelectOther: boolean;
};

type Overview = {
  id: string;
  basedOnOverviewId: string | null;
  versionNumber: number;
  status: "prefilled" | "needs_confirmation" | "ready" | "generated" | "failed";
  items: Item[];
  questions: Question[];
  markdown: string;
  failureCode: string | null;
  savedDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
  citations: { label: string; displayName: string; sourceScope: string; excerpt: string }[];
  comparisonRun: ComparisonRun | null;
};

type ApiBody = {
  overview?: Overview;
  overviews?: Overview[];
  run?: ComparisonRun;
  models?: ModelOptions;
  error?: { message?: string };
};

const statusLabels: Record<string, string> = {
  prefilled: "资料已预填",
  needs_confirmation: "等待确认",
  ready: "可生成",
  generated: "可编辑草稿",
  failed: "生成失败",
  confirmed: "已确认",
  user_confirmed: "已确认",
  inferred: "AI 推断",
  missing: "缺失",
  conflict: "存在冲突",
  not_applicable: "不适用",
};

async function apiRequest(path: string, init?: RequestInit): Promise<ApiBody> {
  const response = await fetch(withBasePath(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const body = (await response.json()) as ApiBody;
  if (!response.ok) throw new Error(body.error?.message ?? "操作未完成");
  return body;
}

export function RequirementOverviewWorkspace({ projectId }: { projectId: string }) {
  const [generationOpened, generationHandlers] = useDisclosure(false);
  const [overviews, setOverviews] = useState<Overview[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [models, setModels] = useState<ModelOptions | null>(null);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"prefill" | "save" | "generate" | "select" | "artifact" | "edit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (selectId?: string) => {
    const result = await apiRequest(`/api/projects/${projectId}/requirement-overviews`);
    const list = result.overviews ?? [];
    setOverviews(list);
    const selected = list.find((item) => item.id === selectId) ?? list[0] ?? null;
    setOverview(selected);
    setMarkdown(selected?.markdown ?? "");
    setLoaded(true);
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "需求概览加载失败");
        setLoaded(true);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadModels = useCallback(async () => {
    const result = await apiRequest(`/api/projects/${projectId}/requirement-overviews/comparison-models`);
    const available = result.models ?? null;
    setModels(available);
    if (available) {
      setSelectedModelIds((current) => current.length ? current : [available.defaultModel.id]);
    }
    return available;
  }, [projectId]);

  const createVersion = async (
    mode: "fresh" | "continue" | "edit",
    basedOn = overview,
  ) => {
    const result = await apiRequest(`/api/projects/${projectId}/requirement-overviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode,
        basedOnOverviewId: mode === "fresh" ? undefined : basedOn?.id,
      }),
    });
    if (!result.overview) throw new Error("新版本未创建");
    setOverview(result.overview);
    setMarkdown(result.overview.markdown);
    setOverviews((current) => [result.overview!, ...current]);
    return result.overview;
  };

  const createFresh = async () => {
    setBusy("prefill");
    setError(null);
    try {
      await createVersion("fresh", null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法建立需求概览");
    } finally {
      setBusy(null);
    }
  };

  const saveAnswers = async () => {
    if (!overview) return;
    setBusy("save");
    setError(null);
    try {
      const result = await apiRequest(`/api/projects/${projectId}/requirement-overviews/${overview.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: overview.questions.map(({ id, answer, status }) => ({
            id,
            answer,
            notApplicable: status === "not_applicable",
          })),
        }),
      });
      if (result.overview) {
        setOverview(result.overview);
        setOverviews((current) => current.map((item) => item.id === result.overview!.id ? result.overview! : item));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const generateFor = async (target: Overview, mode: "single" | "compare", available: ModelOptions) => {
    const modelIds = mode === "single"
      ? [selectedModelIds[0] ?? available.defaultModel.id]
      : selectedModelIds.slice(0, 2);
    const result = await apiRequest(`/api/projects/${projectId}/requirement-overviews/${target.id}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, modelIds }),
    });
    const next = result.run ? { ...target, comparisonRun: result.run } : target;
    setOverview(next);
    setOverviews((current) => current.map((item) => item.id === next.id ? next : item));
  };

  const generate = async (mode: "single" | "compare") => {
    if (!overview) return;
    setBusy("generate");
    setError(null);
    try {
      const available = models ?? await loadModels();
      if (!available) throw new Error("没有测试成功且已启用的文本模型");
      // A comparison run is immutable. A second click must not reuse that
      // run's overview record, even before a candidate has been selected.
      // This keeps every generation request in its own versioned draft.
      const target = overview.status === "generated" || overview.comparisonRun
        ? await createVersion("continue", overview)
        : overview;
      await generateFor(target, mode, available);
      generationHandlers.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "候选生成失败");
      await load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const selectCandidate = async (candidateId: string) => {
    if (!overview?.comparisonRun) return;
    setBusy("select");
    setError(null);
    try {
      const result = await apiRequest(`/api/projects/${projectId}/requirement-overviews/${overview.id}/comparisons/${overview.comparisonRun.id}/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId }),
      });
      if (result.overview) {
        setOverview(result.overview);
        setMarkdown(result.overview.markdown);
        setOverviews((current) => current.map((item) => item.id === result.overview!.id ? result.overview! : item));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "选择候选失败");
    } finally {
      setBusy(null);
    }
  };

  const continueEditing = async () => {
    if (!overview) return;
    setBusy("edit");
    setError(null);
    try {
      await createVersion("edit", overview);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法建立编辑版本");
    } finally {
      setBusy(null);
    }
  };

  const saveAsVersion = async () => {
    if (!overview || overview.status !== "generated") return;
    setBusy("artifact");
    setError(null);
    try {
      let current = overview;
      if (markdown.trim() !== overview.markdown.trim()) {
        const updated = await apiRequest(`/api/projects/${projectId}/requirement-overviews/${overview.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markdown }),
        });
        if (updated.overview) current = updated.overview;
      }
      const saved = await apiRequest(`/api/projects/${projectId}/requirement-overviews/${current.id}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (saved.overview) {
        setOverview(saved.overview);
        setMarkdown(saved.overview.markdown);
        setOverviews((items) => items.map((item) => item.id === saved.overview!.id ? saved.overview! : item));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "另存为新版本失败");
    } finally {
      setBusy(null);
    }
  };

  const openGeneration = async () => {
    generationHandlers.open();
    if (!models) {
      try {
        await loadModels();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "模型配置加载失败");
      }
    }
  };

  const toggleComparisonModel = (modelId: string) => {
    setSelectedModelIds((current) => current.includes(modelId)
      ? current.filter((id) => id !== modelId)
      : current.length >= 2 ? [current[1], modelId] : [...current, modelId]);
  };

  const allModels = useMemo(() => models ? [models.defaultModel, ...models.alternatives] : [], [models]);

  if (!loaded) return <CenterState label="正在加载需求概览" />;

  if (!overview) {
    return (
      <Paper withBorder p="lg" radius="lg" data-testid="requirement-overview-empty">
        <Group justify="space-between" align="flex-start">
          <Box><Title order={4}>需求概览</Title><Text size="sm" c="dimmed" mt={4}>每次生成都会创建独立候选版本；未确认候选不会占用唯一坑位。</Text></Box>
          <Button leftSection={<Sparkles size={16} />} loading={busy === "prefill"} onClick={() => void createFresh()}>开始需求概览</Button>
        </Group>
        {error ? <Alert color="red" mt="md">{error}</Alert> : null}
      </Paper>
    );
  }

  return (
    <Paper withBorder p={{ base: "md", sm: "xl" }} radius="lg" data-testid="requirement-overview-workspace">
      <Group justify="space-between" align="flex-start" gap="md">
        <Box>
          <Group gap="xs"><Title order={4}>需求概览 v{overview.versionNumber}</Title><Badge variant="light">{statusLabels[overview.status]}</Badge>{overview.savedDocumentId ? <Badge color="green" variant="light">已保存为正式版本</Badge> : <Badge color="orange" variant="light">候选 / Draft</Badge>}</Group>
          <Text size="xs" c="dimmed" mt={6}>固定 15 项项目背景 + 9 项需求概览；历史版本不可覆盖。</Text>
        </Box>
        <Select
          aria-label="切换需求概览版本"
          value={overview.id}
          onChange={(value) => {
            const selected = overviews.find((item) => item.id === value);
            if (selected) { setOverview(selected); setMarkdown(selected.markdown); }
          }}
          data={overviews.map((item) => ({ value: item.id, label: `v${item.versionNumber} · ${item.savedDocumentId ? "已保存" : statusLabels[item.status]}` }))}
          w={180}
        />
      </Group>

      {error ? <Alert color="red" title="操作未完成" withCloseButton onClose={() => setError(null)} mt="md">{error}</Alert> : null}

      {overview.status === "generated" ? (
        <Stack mt="lg">
          <Textarea
            label="Markdown 草稿"
            description={overview.savedDocumentId ? "该历史版本不可覆盖；请基于当前版本继续编辑。" : "可编辑后另存为新版本。选择候选不会自动写入项目资料。"}
            value={markdown}
            onChange={(event) => setMarkdown(event.currentTarget.value)}
            autosize
            minRows={16}
            maxRows={28}
            readOnly={Boolean(overview.savedDocumentId)}
            styles={{ input: { fontFamily: "var(--font-geist-mono), monospace", lineHeight: 1.7 } }}
          />
          <Group>
            <Button leftSection={<RefreshCw size={15} />} variant="light" onClick={() => void openGeneration()} data-testid="requirement-overview-generate-dialog-trigger">重新生成</Button>
            <Button leftSection={<PencilLine size={15} />} variant="light" loading={busy === "edit"} onClick={() => void continueEditing()}>基于当前版本继续编辑</Button>
            {!overview.savedDocumentId ? <Button leftSection={<Save size={15} />} loading={busy === "artifact"} onClick={() => void saveAsVersion()}>另存为新版本</Button> : null}
            <Button component="a" href={withBasePath(`/api/projects/${projectId}/requirement-overviews/${overview.id}/export`)} variant="default" leftSection={<Download size={15} />}>下载 Markdown</Button>
          </Group>
        </Stack>
      ) : (
        <Stack mt="lg">
          <Box>
            <Title order={5}>请集中确认</Title>
            <Text size="xs" c="dimmed" mt={4}>必填问题完成后才会生成固定格式的需求概览。</Text>
          </Box>
          {overview.questions.map((question) => (
            <Paper key={question.id} withBorder p="md" radius="md">
              <Group justify="space-between" align="flex-start"><Box><Text size="sm" fw={600}>{question.group}{question.required ? <Text component="span" c="red"> *</Text> : null}</Text><Text size="xs" c="dimmed" mt={4}>{question.prompt}</Text></Box><Button variant="subtle" size="xs" onClick={() => setOverview((current) => current ? { ...current, questions: current.questions.map((item) => item.id === question.id ? { ...item, status: item.status === "not_applicable" ? "pending" : "not_applicable", answer: item.status === "not_applicable" ? item.answer : "" } : item) } : current)}>{question.status === "not_applicable" ? "恢复填写" : "不适用"}</Button></Group>
              <Textarea mt="sm" value={question.answer} disabled={question.status === "not_applicable"} onChange={(event) => { const value = event.currentTarget.value; setOverview((current) => current ? { ...current, questions: current.questions.map((item) => item.id === question.id ? { ...item, answer: value, status: value.trim() ? "answered" : "pending" } : item) } : current); }} placeholder="由项目经理确认，或标记为不适用" autosize minRows={2} />
            </Paper>
          ))}
          <Group><Button variant="light" leftSection={<CheckCircle2 size={15} />} loading={busy === "save"} onClick={() => void saveAnswers()}>保存确认</Button><Button leftSection={<FileText size={15} />} disabled={overview.status !== "ready"} onClick={() => void openGeneration()} data-testid="requirement-overview-generate-dialog-trigger">生成需求概览</Button></Group>
        </Stack>
      )}

      {overview.comparisonRun ? (
        <ComparisonCandidates run={overview.comparisonRun} busy={busy === "select"} onSelect={(candidateId) => void selectCandidate(candidateId)} />
      ) : null}

      <Divider my="lg" />
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {overview.items.map((item) => (
          <Paper key={item.id} withBorder p="sm" radius="md"><Group justify="space-between" gap="xs"><Text size="sm" fw={600}>{item.label}</Text><Badge size="xs" variant="light" color={item.status === "missing" || item.status === "conflict" ? "orange" : "projectBlue"}>{statusLabels[item.status] ?? item.status}</Badge></Group><Text size="xs" c="dimmed" mt={6} lineClamp={3}>{item.value || "TBD"}</Text></Paper>
        ))}
      </SimpleGrid>

      <Modal opened={generationOpened} onClose={generationHandlers.close} title="生成需求概览" size="lg" centered>
        <Stack>
          <Alert color="projectBlue">所有候选使用同一份资料快照、固定 24 字段模板、相同提示词、JSON Schema、温度、Token 上限和引用输入。重新生成会创建新的候选版本。</Alert>
          {!models ? <CenterState label="正在读取可用模型" /> : (
            <>
              <Box>
                <Text fw={600} size="sm">单模型生成</Text>
                <Radio.Group value={selectedModelIds.length === 1 ? selectedModelIds[0] : ""} onChange={(value) => setSelectedModelIds([value])} mt="xs">
                  <Stack gap="xs">{allModels.map((model) => <Radio key={model.id} value={model.id} label={`${model.displayName}${model.isDefault ? "（默认）" : ""}`} />)}</Stack>
                </Radio.Group>
                <Button mt="md" leftSection={<Sparkles size={15} />} loading={busy === "generate"} onClick={() => void generate("single")}>生成一个候选</Button>
              </Box>
              <Divider />
              <Box>
                <Text fw={600} size="sm">比较两个候选</Text>
                {models.canCompare ? <><Text size="xs" c="dimmed" mt={4}>选择两个测试成功且支持结构化输出的文本模型。</Text><Stack gap="xs" mt="sm">{allModels.map((model) => <Checkbox key={model.id} checked={selectedModelIds.includes(model.id)} onChange={() => toggleComparisonModel(model.id)} label={model.displayName} />)}</Stack><Button mt="md" variant="light" leftSection={<GitCompareArrows size={15} />} disabled={selectedModelIds.length !== 2} loading={busy === "generate"} onClick={() => void generate("compare")}>比较两个候选</Button></> : <Alert color="gray" mt="sm">当前只有一个测试成功的文本模型，暂时无法执行模型对比。</Alert>}
              </Box>
            </>
          )}
        </Stack>
      </Modal>
    </Paper>
  );
}

function ComparisonCandidates({ run, busy, onSelect }: { run: ComparisonRun; busy: boolean; onSelect: (id: string) => void }) {
  const baseline = run.candidates[0];
  return (
    <Box mt="xl" data-testid="requirement-overview-model-comparison">
      <Group gap="xs"><Scale size={17} /><Title order={5}>模型候选</Title><Badge variant="light">{run.status === "ready" ? "请选择一个候选" : run.status === "selected" ? "已选择" : run.status === "failed" ? "候选失败" : "生成中"}</Badge></Group>
      <Text size="xs" c="dimmed" mt={4}>候选不会自动保存；选择此候选并形成草稿后，仍需人工编辑和另存为新版本。</Text>
      <SimpleGrid cols={{ base: 1, lg: 2 }} mt="md">
        {run.candidates.map((candidate, index) => {
          const different = index ? candidate.items.filter((item) => { const prior = baseline?.items.find((entry) => entry.id === item.id); return prior && (prior.value !== item.value || prior.status !== item.status); }) : [];
          const completion = Math.round((candidate.items.filter((item) => item.status !== "missing" && item.status !== "conflict").length / Math.max(candidate.items.length, 1)) * 100);
          return (
            <Paper key={candidate.id} withBorder p="md" radius="md">
              <Group justify="space-between"><Box><Text fw={700} size="sm">候选 {candidate.candidateOrder} · {candidate.modelDisplayName}</Text><Text size="xs" c="dimmed">{candidate.providerName} · {candidate.actualModel ?? "未完成"}</Text></Box><Badge color={candidate.status === "ready" ? "green" : candidate.status === "failed" ? "red" : "gray"}>{candidate.status === "ready" ? "可选择" : candidate.status === "failed" ? "失败" : "生成中"}</Badge></Group>
              <Text size="xs" c="dimmed" mt="sm">输入 {candidate.inputTokens ?? "—"} · 输出 {candidate.outputTokens ?? "—"} · 延迟 {candidate.latencyMs ?? "—"} ms · 完成度 {completion}%</Text>
              {different.length ? <Text size="xs" c="dimmed" mt={6}>与候选 1 不同：{different.slice(0, 6).map((item) => item.label).join("、")}{different.length > 6 ? " 等" : ""}</Text> : null}
              <ScrollArea h={180} mt="sm"><Stack gap={6}>{candidate.items.map((item) => <Text key={item.id} size="xs"><Text component="span" fw={600}>{item.label}：</Text>{item.value || "TBD"}</Text>)}</Stack></ScrollArea>
              <Button mt="md" fullWidth leftSection={<CheckCircle2 size={15} />} disabled={run.status !== "ready" || candidate.status !== "ready"} loading={busy} onClick={() => onSelect(candidate.id)}>选择此候选并形成草稿</Button>
            </Paper>
          );
        })}
      </SimpleGrid>
    </Box>
  );
}

function CenterState({ label }: { label: string }) {
  return <Group justify="center" p="xl"><Loader size="sm" /><Text size="sm" c="dimmed">{label}</Text></Group>;
}
