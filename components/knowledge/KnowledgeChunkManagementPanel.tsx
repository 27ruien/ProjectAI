"use client";

import { useEffect, useMemo, useState } from "react";
import { Braces, LoaderCircle, RefreshCw, RotateCcw, ShieldX } from "lucide-react";
import { Button } from "@/components/common/button";
import { reindexProjectDocumentVersion } from "@/lib/documents/client";
import {
  listManagedKnowledgeChunks,
  mutateManagedKnowledgeChunk,
} from "@/lib/knowledge/client";
import type { ProjectDocumentDto } from "@/types/documents";
import type {
  KnowledgeChunkListResponse,
  KnowledgeChunkManagementDto,
} from "@/types/knowledge-chunks";

type Props = {
  projectId: string;
  documents: ProjectDocumentDto[];
};

function statusLabel(chunk: KnowledgeChunkManagementDto): string {
  if (!chunk.isEffective) return "已禁用";
  if (chunk.embeddingStatus === "current") return "索引就绪";
  if (chunk.embeddingStatus === "pending") return "向量待生成";
  if (chunk.embeddingStatus === "disabled") return "向量功能关闭";
  return chunk.embeddingStatus;
}

export function KnowledgeChunkManagementPanel({ projectId, documents }: Props) {
  const manageable = useMemo(
    () =>
      documents.filter(
        (document) =>
          document.permissions.canReindex &&
          document.currentVersion?.ingestion.status === "succeeded",
      ),
    [documents],
  );
  const [documentId, setDocumentId] = useState("");
  const [data, setData] = useState<KnowledgeChunkListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDocumentId = documentId || manageable[0]?.id || "";

  const load = async (id = selectedDocumentId) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setData(await listManagedKnowledgeChunks(projectId, id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分块加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (selectedDocumentId) {
      void Promise.resolve()
        .then(() => {
          setLoading(true);
          setError(null);
          return listManagedKnowledgeChunks(
            projectId,
            selectedDocumentId,
            controller.signal,
          );
        })
        .then(setData)
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : "分块加载失败");
        })
        .finally(() => setLoading(false));
    }
    return () => controller.abort();
  }, [projectId, selectedDocumentId]);

  if (!manageable.length) return null;

  const mutate = async (
    chunk: KnowledgeChunkManagementDto,
    action: "disable" | "enable" | "regenerate_embedding",
  ) => {
    setPending(`${chunk.id}:${action}`);
    setError(null);
    setMessage(null);
    try {
      await mutateManagedKnowledgeChunk({
        projectId,
        documentId: chunk.documentId,
        chunkId: chunk.id,
        action,
        expectedContentSha256: chunk.contentSha256,
      });
      setMessage(
        action === "disable"
          ? "分块已从检索范围中禁用。"
          : action === "enable"
            ? "分块已启用，并进入向量补齐队列。"
            : "Embedding 已进入受控重建队列。",
      );
      await load(chunk.documentId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分块操作失败");
    } finally {
      setPending(null);
    }
  };

  const reparse = async () => {
    const document = manageable.find((item) => item.id === selectedDocumentId);
    if (!document?.currentVersion) return;
    setPending("reparse");
    setError(null);
    setMessage(null);
    try {
      await reindexProjectDocumentVersion(
        projectId,
        document.id,
        document.currentVersion.id,
      );
      setMessage("已使用受审查的版本化解析策略进入重新解析队列。旧索引会保留到新一代成功。 ");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重新解析失败");
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Braces className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">分块与解析管理</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            仅项目管理员可查看当前版本结构、禁用错误分块或触发受控重建；普通成员不会获得此接口。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedDocumentId}
            onChange={(event) => setDocumentId(event.target.value)}
            className="h-9 min-w-56 rounded-md border border-input bg-background px-3 text-xs"
          >
            {manageable.map((document) => (
              <option key={document.id} value={document.id}>{document.displayName}</option>
            ))}
          </select>
          <Button type="button" size="sm" variant="outline" loading={pending === "reparse"} onClick={() => void reparse()}>
            <RotateCcw className="size-3.5" />重新解析
          </Button>
        </div>
      </div>
      {data ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Parser {data.parserVersion} · Chunker {data.chunkerVersion} · {data.chunks.length} 个分块
        </p>
      ) : null}
      {message ? <p className="mt-3 text-xs text-success">{message}</p> : null}
      {error ? <p className="mt-3 text-xs text-destructive" role="alert">{error}</p> : null}
      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在加载授权分块</div>
      ) : null}
      {!loading && data ? (
        <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {data.chunks.map((chunk) => (
            <article key={chunk.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    #{chunk.chunkIndex + 1} · {chunk.chunkType} · {statusLabel(chunk)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    解析质量 {Math.round(chunk.parseQualityBps / 100)}% · 约 {chunk.estimatedTokenCount} tokens
                    {chunk.headingPath.length ? ` · ${chunk.headingPath.join(" / ")}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={pending === `${chunk.id}:regenerate_embedding`}
                    disabled={!chunk.isEffective || Boolean(pending)}
                    onClick={() => void mutate(chunk, "regenerate_embedding")}
                  >
                    <RefreshCw className="size-3.5" />重建向量
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={pending === `${chunk.id}:${chunk.isEffective ? "disable" : "enable"}`}
                    disabled={Boolean(pending)}
                    onClick={() => void mutate(chunk, chunk.isEffective ? "disable" : "enable")}
                  >
                    <ShieldX className="size-3.5" />{chunk.isEffective ? "禁用" : "启用"}
                  </Button>
                </div>
              </div>
              <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-foreground">
                {chunk.summary || chunk.content}
              </p>
              {chunk.keywords.length ? (
                <p className="mt-2 text-[11px] text-muted-foreground">关键词：{chunk.keywords.join("、")}</p>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
