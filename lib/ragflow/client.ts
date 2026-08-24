import { RagflowError } from "./errors";
import type { RagflowConfig } from "./config";
import type {
  RagflowDataset,
  RagflowDocument,
  RagflowDocumentParseStatus,
  RagflowEvidence,
  RagflowRetrievalResult,
} from "./types";

type Envelope = { code?: unknown; data?: unknown; message?: unknown };

type FetchOptions = {
  method?: "GET" | "POST" | "DELETE" | "PUT";
  body?: unknown;
  formData?: FormData;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function statusFromRun(run: unknown): RagflowDocumentParseStatus {
  const normalized = String(run ?? "").trim().toUpperCase();
  if (normalized === "DONE" || normalized === "3") return "ready";
  if (normalized === "FAIL" || normalized === "CANCEL" || normalized === "4" || normalized === "2")
    return "failed";
  return "processing";
}

function parseDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  return null;
}

function httpError(status: number): RagflowError {
  if (status === 401 || status === 403)
    return new RagflowError(503, "RAGFLOW_UNAUTHORIZED", "知识服务鉴权失败", false);
  if (status === 404)
    return new RagflowError(503, "RAGFLOW_NOT_FOUND", "知识服务资源不存在", false);
  if (status === 429)
    return new RagflowError(503, "RAGFLOW_RATE_LIMITED", "知识服务繁忙，请稍后重试", true);
  if (status >= 500)
    return new RagflowError(503, "RAGFLOW_UNAVAILABLE", "知识服务暂时不可用", true);
  return new RagflowError(502, "RAGFLOW_REQUEST_REJECTED", "知识服务拒绝了请求", false);
}

export class RagflowClient {
  constructor(
    private readonly config: RagflowConfig,
    private readonly apiKey: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  private async request(path: string, options: FetchOptions = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.config.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(options.formData ? {} : { "content-type": "application/json" }),
        },
        body: options.formData
          ? options.formData
          : options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new RagflowError(503, "RAGFLOW_TIMEOUT", "知识服务响应超时", true);
      }
      throw new RagflowError(503, "RAGFLOW_UNAVAILABLE", "知识服务暂时不可用", true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw httpError(response.status);
    let envelope: Envelope;
    try {
      envelope = (await response.json()) as Envelope;
    } catch {
      throw new RagflowError(502, "RAGFLOW_INVALID_RESPONSE", "知识服务返回无效", false);
    }
    if (envelope.code !== 0) {
      throw new RagflowError(502, "RAGFLOW_REQUEST_REJECTED", "知识服务请求未完成", false);
    }
    return envelope.data;
  }

  async health(): Promise<void> {
    await this.request("/datasets?page=1&page_size=1");
  }

  async createDataset(input: {
    name: string;
    description?: string;
  }): Promise<RagflowDataset> {
    const data = recordValue(await this.request("/datasets", {
      method: "POST",
      body: {
        name: input.name,
        description: input.description ?? "",
        permission: "me",
        chunk_method: "naive",
      },
    }));
    const id = stringValue(data?.id);
    const name = stringValue(data?.name);
    if (!id || !name) throw new RagflowError(502, "RAGFLOW_INVALID_RESPONSE", "知识服务返回无效", false);
    return {
      id,
      name,
      documentCount: numberValue(data?.document_count) ?? 0,
    };
  }

  async listDatasets(input: { id?: string; name?: string } = {}): Promise<RagflowDataset[]> {
    // RAGFlow v0.27 returns code 102, rather than an empty array, when an
    // exact `id` or `name` filter has no match. Provisioning needs absence to
    // be a normal state, so enumerate accessible datasets and filter locally.
    const data: unknown[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const pageData = await this.request(`/datasets?page=${page}&page_size=100`);
      if (!Array.isArray(pageData)) {
        throw new RagflowError(502, "RAGFLOW_INVALID_RESPONSE", "知识服务返回无效", false);
      }
      data.push(...pageData);
      if (pageData.length < 100) break;
      if (page === 100) {
        throw new RagflowError(502, "RAGFLOW_INVALID_RESPONSE", "知识服务返回无效", false);
      }
    }
    return data.flatMap((item) => {
      const record = recordValue(item);
      const id = stringValue(record?.id);
      const name = stringValue(record?.name);
      if (!id || !name) return [];
      return [{ id, name, documentCount: numberValue(record?.document_count) ?? 0 }];
    }).filter((item) =>
      (!input.id || item.id === input.id) &&
      (!input.name || item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase()),
    );
  }

  async deleteDataset(datasetId: string): Promise<void> {
    const existing = await this.listDatasets({ id: datasetId });
    if (!existing.some((item) => item.id === datasetId)) return;
    await this.request("/datasets", { method: "DELETE", body: { ids: [datasetId] } });
  }

  async uploadDocument(input: {
    datasetId: string;
    filename: string;
    blob: Blob;
  }): Promise<RagflowDocument> {
    const form = new FormData();
    form.append("file", input.blob, input.filename);
    const data = await this.request(`/datasets/${encodeURIComponent(input.datasetId)}/documents`, {
      method: "POST",
      formData: form,
    });
    if (!Array.isArray(data) || data.length !== 1) {
      throw new RagflowError(502, "RAGFLOW_INVALID_RESPONSE", "知识服务返回无效", false);
    }
    return this.documentFromRecord(data[0], input.datasetId);
  }

  async parseDocuments(datasetId: string, documentIds: string[]): Promise<void> {
    await this.request(`/datasets/${encodeURIComponent(datasetId)}/chunks`, {
      method: "POST",
      body: { document_ids: documentIds },
    });
  }

  async listDocuments(datasetId: string): Promise<RagflowDocument[]> {
    const data = recordValue(await this.request(
      `/datasets/${encodeURIComponent(datasetId)}/documents?page=1&page_size=100&desc=true`,
    ));
    const docs = data?.docs;
    if (!Array.isArray(docs)) throw new RagflowError(502, "RAGFLOW_INVALID_RESPONSE", "知识服务返回无效", false);
    return docs.map((item) => this.documentFromRecord(item, datasetId));
  }

  async getDocumentStatus(datasetId: string, documentId: string): Promise<RagflowDocument | null> {
    const data = recordValue(await this.request(
      `/datasets/${encodeURIComponent(datasetId)}/documents?id=${encodeURIComponent(documentId)}&page=1&page_size=1`,
    ));
    const docs = data?.docs;
    if (!Array.isArray(docs) || docs.length === 0) return null;
    return this.documentFromRecord(docs[0], datasetId);
  }

  async deleteDocument(datasetId: string, documentId: string): Promise<void> {
    await this.request(`/datasets/${encodeURIComponent(datasetId)}/documents`, {
      method: "DELETE",
      body: { ids: [documentId] },
    });
  }

  async retrieve(input: {
    question: string;
    datasetIds: string[];
    limit: number;
  }): Promise<RagflowRetrievalResult> {
    const started = performance.now();
    const data = recordValue(await this.request("/retrieval", {
      method: "POST",
      body: {
        question: input.question,
        dataset_ids: input.datasetIds,
        page: 1,
        page_size: input.limit,
        similarity_threshold: this.config.retrievalThreshold,
        top_k: this.config.retrievalTopK,
        // RAGFlow's `keyword=true` performs LLM-based keyword extraction and
        // therefore requires a chat model configured inside RAGFlow. Project
        // AI owns answer generation through its AI Gateway; retrieval must
        // remain usable with RAGFlow's embedding service alone.
        keyword: false,
        highlight: false,
      },
    }));
    const chunks = data?.chunks;
    if (!Array.isArray(chunks)) throw new RagflowError(502, "RAGFLOW_INVALID_RESPONSE", "知识服务返回无效", false);
    const evidence: RagflowEvidence[] = chunks.slice(0, input.limit).flatMap((item) => {
      const record = recordValue(item);
      const id = stringValue(record?.id);
      const datasetId = stringValue(record?.dataset_id);
      const documentId = stringValue(record?.document_id);
      const content = stringValue(record?.content);
      if (!id || !datasetId || !documentId || !content) return [];
      return [{
        id,
        datasetId,
        documentId,
        documentName: stringValue(record?.document_keyword) ?? "来源文件",
        content: content.slice(0, 8_000),
        similarity: numberValue(record?.similarity),
      }];
    });
    return {
      evidence,
      total: numberValue(data?.total) ?? evidence.length,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  private documentFromRecord(value: unknown, fallbackDatasetId: string): RagflowDocument {
    const record = recordValue(value);
    const id = stringValue(record?.id);
    const name = stringValue(record?.name);
    if (!record || !id || !name) {
      throw new RagflowError(502, "RAGFLOW_INVALID_RESPONSE", "知识服务返回无效", false);
    }
    const run = stringValue(record.run) ?? "UNSTART";
    return {
      id,
      datasetId:
        stringValue(record.dataset_id) ??
        stringValue(record.knowledgebase_id) ??
        fallbackDatasetId,
      name,
      size: numberValue(record.size),
      run,
      parseStatus: statusFromRun(run),
      progress: numberValue(record.progress),
      createdAt: parseDate(record.create_time ?? record.create_date),
      updatedAt: parseDate(record.update_time ?? record.update_date),
    };
  }
}
