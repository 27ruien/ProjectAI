import {
  mockKnowledgeChunks,
  mockProjectDocuments,
  mockSourceCitations,
} from "@/data/mock";
import type {
  KnowledgeChunk,
  MatchedKnowledgeDocument,
  ProjectDocument,
  ProjectKnowledgeMatch,
  ProjectKnowledgeSearchInput,
  ProjectKnowledgeSearchResult,
  ProjectQuestionInput,
  ProjectQuestionResult,
  SourceCitation,
} from "@/types";
import type { ProjectKnowledgeService } from "./project-knowledge-service";

export interface MockProjectKnowledgeServiceOptions {
  chunks?: KnowledgeChunk[];
  citations?: SourceCitation[];
  documents?: ProjectDocument[];
  latencyMs?: number;
}

function executionId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalize(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s，。？！、：；（）()]/g, "");
}

export class MockProjectKnowledgeService implements ProjectKnowledgeService {
  private readonly chunks: KnowledgeChunk[];
  private readonly citations: SourceCitation[];
  private readonly documents: ProjectDocument[];
  private readonly latencyMs: number;

  constructor(options: MockProjectKnowledgeServiceOptions = {}) {
    this.chunks = options.chunks ?? mockKnowledgeChunks;
    this.citations = options.citations ?? mockSourceCitations;
    this.documents = options.documents ?? mockProjectDocuments;
    this.latencyMs = options.latencyMs ?? 160;
  }

  async searchProjectKnowledge(
    input: ProjectKnowledgeSearchInput,
  ): Promise<ProjectKnowledgeSearchResult> {
    const started = Date.now();
    await this.delay();
    const normalizedQuery = normalize(input.query);
    const terms = input.query
      .split(/[\s，。？！、：；（）()]+/)
      .map(normalize)
      .filter((term) => term.length > 0);

    const matches: ProjectKnowledgeMatch[] = this.chunks
      .filter((chunk) => chunk.projectId === input.projectId)
      .filter((chunk) => !input.filters?.documentTypes || input.filters.documentTypes.includes(chunk.documentType))
      .filter((chunk) => !input.filters?.layers || input.filters.layers.includes(chunk.layer))
      .filter((chunk) => !input.filters?.permissionScopes || input.filters.permissionScopes.includes(chunk.permissionScope))
      .filter((chunk) => !input.filters?.status || input.filters.status.includes(chunk.status))
      .filter((chunk) => !input.filters?.effectiveOnly || chunk.status === "active")
      .map((chunk) => {
        const haystack = normalize(`${chunk.content}${chunk.section}${chunk.keywords.join("")}`);
        const exactBonus = normalizedQuery && haystack.includes(normalizedQuery) ? 0.55 : 0;
        const termHits = terms.filter((term) => haystack.includes(term)).length;
        const keywordHits = chunk.keywords.filter((keyword) => normalizedQuery.includes(normalize(keyword))).length;
        const score = Math.min(0.99, 0.28 + exactBonus + termHits * 0.1 + keywordHits * 0.08);
        const citation = this.citations.find((item) => item.chunkId === chunk.chunkId);
        return citation ? { chunk, score, citation } : undefined;
      })
      .filter((match): match is ProjectKnowledgeMatch => Boolean(match))
      .filter((match) => normalizedQuery.length === 0 || match.score > 0.28)
      .sort((left, right) => right.score - left.score);

    const limited = matches.slice(0, input.limit ?? 8);
    return {
      query: input.query,
      matches: limited,
      total: matches.length,
      executionId: executionId("knowledge-search"),
      latency: Date.now() - started,
    };
  }

  async answerProjectQuestion(
    input: ProjectQuestionInput,
  ): Promise<ProjectQuestionResult> {
    const started = Date.now();
    const preset = this.resolvePreset(input.question, input.projectId);
    const search = await this.searchProjectKnowledge({
      projectId: input.projectId,
      query: preset.searchQuery,
      filters: input.filters,
      limit: 4,
    });
    const citations = search.matches.map((match) => match.citation);
    const matchedDocuments = this.toMatchedDocuments(search.matches);
    const answer = preset.answer ?? this.fallbackAnswer(input.question, citations);

    return {
      answer,
      citations,
      confidence: citations.length > 0 ? preset.confidence : 0.58,
      matchedDocuments,
      effectiveVersionUsed: this.effectiveVersion(citations),
      executionId: executionId("project-qa"),
      modelProfileId: "project-qa",
      latency: Date.now() - started,
      mockCost: Number((0.18 + citations.length * 0.07).toFixed(2)),
    };
  }

  async getDocumentCitations(sourceIds: string[]): Promise<SourceCitation[]> {
    await this.delay();
    const ids = new Set(sourceIds);
    return this.citations.filter(
      (citation) =>
        ids.has(citation.id) ||
        ids.has(citation.documentId) ||
        ids.has(citation.chunkId),
    );
  }

  private resolvePreset(question: string, projectId: string): {
    searchQuery: string;
    answer?: string;
    confidence: number;
  } {
    if (projectId !== "project-001") {
      return { searchQuery: question, confidence: 0.82 };
    }
    if (/Scope|范围|版本/i.test(question)) {
      return {
        searchQuery: "当前有效 Scope v1.3 西班牙语 弱网",
        answer: "当前有效 Scope 是 v1.3，于 2026 年 7 月 11 日生效。相较 v1.2，它新增了西班牙语互动与弱网静态兜底；人脸识别、会员身份匹配和自动营销邮件仍明确在首期范围外。",
        confidence: 0.96,
      };
    }
    if (/目标|客户提出/i.test(question)) {
      return {
        searchQuery: "客户确认 上线 语言 扫码 品牌安全",
        answer: "客户的关键目标是按 8 月 28 日窗口上线纽约旗舰店互动体验，支持英语与西班牙语、扫码带走结果，并确保所有生成内容通过品牌安全校验。",
        confidence: 0.93,
      };
    }
    if (/新增.*需求|最近新增/i.test(question)) {
      return {
        searchQuery: "西班牙语 弱网 新增需求",
        answer: "最近新增的两项关键需求是全流程西班牙语支持，以及网络连续 5 秒无响应时切换为静态互动兜底。西班牙语语音是否纳入首期仍待确认。",
        confidence: 0.94,
      };
    }
    if (/风险|最大/i.test(question)) {
      return {
        searchQuery: "素材授权 最晚 7月18日 风险",
        answer: "当前最大风险是素材授权延迟：仍有 12 项素材缺少北美区域授权证明，最晚需在 7 月 18 日交付，否则会压缩门店验收时间。建议同步准备替代素材清单。",
        confidence: 0.91,
      };
    }
    if (/过期|逾期|Action/i.test(question)) {
      return {
        searchQuery: "Action 待办 复核",
        answer: "当前已逾期的重点 Action 包括语言选择埋点字典更新；素材授权证明也处于关键截止窗口，需要项目经理当天跟进。",
        confidence: 0.86,
      };
    }
    if (/上线日期|为什么.*变化/i.test(question)) {
      return {
        searchQuery: "上线日期 8月28日 保持不变",
        answer: "最近一次客户周会确认上线日期没有变化，仍为 2026 年 8 月 28 日。Scope v1.3 的新增工作通过翻译、开发与测试并行安排吸收。",
        confidence: 0.95,
      };
    }
    if (/最近一次客户|确认.*内容/i.test(question)) {
      return {
        searchQuery: "客户确认 西班牙语 弱网 上线",
        answer: "最近一次客户确认了三项内容：西班牙语文本纳入首期、增加弱网静态兜底、上线日期保持 8 月 28 日不变；西班牙语语音仍待确认。",
        confidence: 0.95,
      };
    }
    return { searchQuery: question, confidence: 0.82 };
  }

  private fallbackAnswer(question: string, citations: SourceCitation[]): string {
    if (citations.length === 0) {
      return `暂未在当前项目的可访问知识中找到足够证据回答“${question}”。建议补充关键词或检查资料权限与版本状态。`;
    }
    return `根据当前项目资料，最相关的信息是：${citations[0].citationText}。该结论仍建议结合下方来源核对后使用。`;
  }

  private toMatchedDocuments(matches: ProjectKnowledgeMatch[]): MatchedKnowledgeDocument[] {
    const scores = new Map<string, number>();
    matches.forEach((match) => {
      scores.set(match.citation.documentId, Math.max(scores.get(match.citation.documentId) ?? 0, match.score));
    });
    return [...scores.entries()].map(([documentId, score]) => {
      const document = this.documents.find((item) => item.id === documentId);
      return {
        documentId,
        documentName: document?.name ?? "未知文档",
        score,
        isEffective: document?.isEffective ?? false,
      };
    });
  }

  private effectiveVersion(citations: SourceCitation[]): string {
    const effective = citations.find((citation) => citation.isEffective);
    return effective ? `${effective.documentName} · ${effective.version}` : "未匹配当前有效版本";
  }

  private async delay(): Promise<void> {
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, this.latencyMs));
  }
}

export const mockProjectKnowledgeService = new MockProjectKnowledgeService();
