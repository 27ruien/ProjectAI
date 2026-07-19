import { createEmbeddingGateway } from "../lib/ai/embeddings/gateway";
import { getEmbeddingRuntimeConfig } from "../lib/ai/embeddings/config";
import { HYBRID_RETRIEVAL_PROFILE } from "../lib/ai/retrieval/config";
import { reciprocalRankFusion } from "../lib/ai/retrieval/rrf";

const fictionalChunks = [
  { id: "aurora-cutover", projectId: "fictional-aurora", text: "极光计划的生产切换日期为 2031 年 9 月 18 日。" },
  { id: "aurora-budget", projectId: "fictional-aurora", text: "极光计划的虚构预算上限为 480 万元。" },
  { id: "nebula-cutover", projectId: "fictional-nebula", text: "星云计划在 2032 年完成发布。" },
];
const query = "极光计划的生产切换日期为 2031 年 9 月 18 日。";

function lexicalFeatures(text: string): Set<string> {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const features = new Set(normalized.match(/[a-z0-9][a-z0-9._%-]*/gu) ?? []);
  const cjk = (normalized.match(/[\p{Script=Han}]/gu) ?? []).join("");
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    features.add(cjk.slice(index, index + 2));
  }
  return features;
}

function lexicalScore(queryText: string, content: string): number {
  const queryFeatures = lexicalFeatures(queryText);
  const contentFeatures = lexicalFeatures(content);
  return [...queryFeatures].filter((feature) => contentFeatures.has(feature)).length;
}

function cosineDistance(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return 1 - dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

async function main(): Promise<void> {
  const runtime = getEmbeddingRuntimeConfig();
  const gateway = createEmbeddingGateway({
    ...runtime,
    enabled: true,
    batchSize: 10,
    batchMaxCharacters: 30_000,
  });
  const eligible = fictionalChunks.filter(
    (chunk) => chunk.projectId === "fictional-aurora",
  );
  const result = await gateway.embed([query, ...eligible.map((chunk) => chunk.text)]);
  const queryVector = result.vectors[0]!;
  const vector = eligible
    .map((chunk, index) => ({
      chunkId: chunk.id,
      rank: 0,
      score: cosineDistance(queryVector, result.vectors[index + 1]!),
      value: chunk,
    }))
    .filter((candidate) => candidate.score <= HYBRID_RETRIEVAL_PROFILE.vectorMaxDistance)
    .sort((left, right) => left.score - right.score || left.chunkId.localeCompare(right.chunkId))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const lexical = eligible
    .map((chunk) => ({
      chunkId: chunk.id,
      rank: 0,
      score: lexicalScore(query, chunk.text),
      value: chunk,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const fused = reciprocalRankFusion({
    lexical,
    vector,
    rrfK: HYBRID_RETRIEVAL_PROFILE.rrfK,
    lexicalWeight: HYBRID_RETRIEVAL_PROFILE.lexicalWeight,
    vectorWeight: HYBRID_RETRIEVAL_PROFILE.vectorWeight,
    limit: HYBRID_RETRIEVAL_PROFILE.evidenceLimit,
  });
  if (queryVector.length !== 1024 || queryVector.some((value) => !Number.isFinite(value))) {
    throw new Error("Query embedding contract failed.");
  }
  if (fused.some((candidate) => candidate.value.projectId !== "fictional-aurora")) {
    throw new Error("Retrieval project scope failed.");
  }
  if (lexical.length === 0 || vector.length === 0 || fused.length === 0) {
    throw new Error("Retrieval candidate contract failed.");
  }
  process.stdout.write(`${JSON.stringify({
    fixture: "fictional-aurora",
    provider: result.provider,
    dimensions: queryVector.length,
    finite: true,
    lexicalCandidateLabels: lexical.map((candidate) => candidate.chunkId),
    vectorCandidateLabels: vector.map((candidate) => candidate.chunkId),
    fusedCandidateLabels: fused.map((candidate) => candidate.chunkId),
    finalEvidenceLabels: fused.slice(0, HYBRID_RETRIEVAL_PROFILE.evidenceLimit).map((candidate) => candidate.chunkId),
    projectScoped: true,
    vectorOutput: false,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Retrieval probe failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
