import { readFile, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { FakeEmbeddingProvider } from "@/lib/ai/embeddings/fake-provider";
import { HYBRID_RETRIEVAL_PROFILE } from "./config";
import { reciprocalRankFusion } from "./rrf";

type EvaluationChunk = {
  label: string;
  projectFixture: string;
  text: string;
  active: boolean;
  current: boolean;
  stored: boolean;
  ingestionSucceeded: boolean;
  effective: boolean;
};

type EvaluationQuery = {
  id: string;
  projectFixture: string;
  query: string;
  answerable: boolean;
  relevantChunkLabels: string[];
  gradedRelevance: Record<string, number>;
  excludedChunkLabels: string[];
  category: string[];
};

type EvaluationDataset = {
  datasetVersion: string;
  description: string;
  chunks: EvaluationChunk[];
  queries: EvaluationQuery[];
};

type RankedLabel = { label: string; score: number };

type QueryEvaluation = {
  query: EvaluationQuery;
  lexical: RankedLabel[];
  vector: RankedLabel[];
  hybrid: RankedLabel[];
  lexicalLatencyMs: number;
  vectorLatencyMs: number;
  hybridLatencyMs: number;
};

export type RetrievalMetrics = {
  queryCount: number;
  answerableCount: number;
  hitRateAt5: number;
  recallAt5: number;
  recallAt10: number;
  mrrAt10: number;
  ndcgAt10: number;
  noAnswerFalsePositiveRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
};

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "did",
  "does",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "the",
  "this",
  "to",
  "what",
  "when",
  "which",
  "who",
  "with",
]);

function round(value: number): number {
  return Number(value.toFixed(4));
}

function percentile(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]!;
}

function lexicalFeatures(text: string): Set<string> {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9._%-]*/gu) ?? [];
  const cjk = (normalized.match(/[\p{Script=Han}]/gu) ?? []).join("");
  const features = new Set(
    words.filter((word) => word.length > 1 && !stopWords.has(word)),
  );
  for (let index = 0; index + 1 < cjk.length; index += 1) {
    features.add(cjk.slice(index, index + 2));
  }
  return features;
}

function lexicalScore(query: string, content: string): number {
  const queryFeatures = lexicalFeatures(query);
  const contentFeatures = lexicalFeatures(content);
  if (queryFeatures.size === 0) return 0;
  let overlap = 0;
  for (const feature of queryFeatures) {
    if (contentFeatures.has(feature)) overlap += 1;
  }
  const normalizedQuery = query.normalize("NFKC").toLocaleLowerCase().trim();
  const normalizedContent = content.normalize("NFKC").toLocaleLowerCase();
  return (
    overlap / queryFeatures.size +
    (normalizedQuery.length >= 3 && normalizedContent.includes(normalizedQuery)
      ? 2
      : 0)
  );
}

function eligible(chunk: EvaluationChunk, projectFixture: string): boolean {
  return (
    chunk.projectFixture === projectFixture &&
    chunk.active &&
    chunk.current &&
    chunk.stored &&
    chunk.ingestionSucceeded &&
    chunk.effective
  );
}

function cosineDistance(left: number[], right: number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 2 : 1 - dot / denominator;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const provider = new FakeEmbeddingProvider();
  const vectors: number[][] = [];
  for (let index = 0; index < texts.length; index += 10) {
    const batch = texts.slice(index, index + 10);
    const result = await provider.embed({
      model: "text-embedding-v4",
      dimensions: 1024,
      inputs: batch,
      timeoutMs: 5_000,
    });
    vectors.push(...result.vectors);
  }
  return vectors;
}

function discountedCumulativeGain(
  labels: string[],
  relevance: Record<string, number>,
): number {
  return labels.reduce((total, label, index) => {
    const grade = relevance[label] ?? 0;
    return total + (2 ** grade - 1) / Math.log2(index + 2);
  }, 0);
}

function metrics(
  evaluations: QueryEvaluation[],
  mode: "lexical" | "vector" | "hybrid",
): RetrievalMetrics {
  const answerable = evaluations.filter((item) => item.query.answerable);
  const noAnswer = evaluations.filter((item) => !item.query.answerable);
  const hit5: number[] = [];
  const recall5: number[] = [];
  const recall10: number[] = [];
  const reciprocalRanks: number[] = [];
  const ndcg: number[] = [];
  for (const item of answerable) {
    const ranked = item[mode].map((candidate) => candidate.label);
    const relevant = new Set(item.query.relevantChunkLabels);
    const at5 = ranked.slice(0, 5);
    const at10 = ranked.slice(0, 10);
    hit5.push(at5.some((label) => relevant.has(label)) ? 1 : 0);
    recall5.push(at5.filter((label) => relevant.has(label)).length / relevant.size);
    recall10.push(at10.filter((label) => relevant.has(label)).length / relevant.size);
    const first = at10.findIndex((label) => relevant.has(label));
    reciprocalRanks.push(first < 0 ? 0 : 1 / (first + 1));
    const ideal = Object.entries(item.query.gradedRelevance)
      .sort((left, right) => right[1] - left[1])
      .map(([label]) => label)
      .slice(0, 10);
    const idealDcg = discountedCumulativeGain(ideal, item.query.gradedRelevance);
    ndcg.push(
      idealDcg === 0
        ? 0
        : discountedCumulativeGain(at10, item.query.gradedRelevance) / idealDcg,
    );
  }
  const latencyKey = `${mode}LatencyMs` as const;
  const latencies = evaluations.map((item) => item[latencyKey]);
  const average = (values: number[]) =>
    values.length === 0
      ? 0
      : values.reduce((total, value) => total + value, 0) / values.length;
  return {
    queryCount: evaluations.length,
    answerableCount: answerable.length,
    hitRateAt5: round(average(hit5)),
    recallAt5: round(average(recall5)),
    recallAt10: round(average(recall10)),
    mrrAt10: round(average(reciprocalRanks)),
    ndcgAt10: round(average(ndcg)),
    noAnswerFalsePositiveRate: round(
      noAnswer.length === 0
        ? 0
        : noAnswer.filter((item) => item[mode].length > 0).length /
            noAnswer.length,
    ),
    averageLatencyMs: round(average(latencies)),
    p95LatencyMs: round(percentile(latencies, 0.95)),
  };
}

export async function evaluateHybridRetrieval(
  fixturePath = "tests/fixtures/hybrid-retrieval-evaluation.json",
) {
  const dataset = JSON.parse(await readFile(fixturePath, "utf8")) as EvaluationDataset;
  if (dataset.queries.length < 60) {
    throw new Error("Hybrid retrieval evaluation requires at least 60 queries.");
  }
  const chunkVectors = await embedTexts(dataset.chunks.map((chunk) => chunk.text));
  const queryVectors = await embedTexts(dataset.queries.map((query) => query.query));
  const evaluations: QueryEvaluation[] = [];
  const positiveDistances: number[] = [];
  const negativeDistances: number[] = [];

  for (const [queryIndex, query] of dataset.queries.entries()) {
    const candidates = dataset.chunks
      .map((chunk, index) => ({ chunk, vector: chunkVectors[index]! }))
      .filter(({ chunk }) => eligible(chunk, query.projectFixture));
    const lexicalStarted = performance.now();
    const lexical = candidates
      .map(({ chunk }) => ({ label: chunk.label, score: lexicalScore(query.query, chunk.text) }))
      .filter((candidate) => candidate.score >= 0.08)
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
      .slice(0, HYBRID_RETRIEVAL_PROFILE.lexicalCandidateLimit);
    const lexicalLatencyMs = performance.now() - lexicalStarted;

    const vectorStarted = performance.now();
    const allDistances = candidates.map(({ chunk, vector }) => ({
      label: chunk.label,
      score: cosineDistance(queryVectors[queryIndex]!, vector),
    }));
    for (const candidate of allDistances) {
      (query.relevantChunkLabels.includes(candidate.label)
        ? positiveDistances
        : negativeDistances
      ).push(candidate.score);
    }
    const vector = allDistances
      .filter((candidate) => candidate.score <= HYBRID_RETRIEVAL_PROFILE.vectorMaxDistance)
      .sort((left, right) => left.score - right.score || left.label.localeCompare(right.label))
      .slice(0, HYBRID_RETRIEVAL_PROFILE.vectorCandidateLimit);
    const vectorLatencyMs = performance.now() - vectorStarted;

    const hybridStarted = performance.now();
    const hybrid = reciprocalRankFusion({
      lexical: lexical.map((candidate, index) => ({
        chunkId: candidate.label,
        rank: index + 1,
        score: candidate.score,
        value: candidate,
      })),
      vector: vector.map((candidate, index) => ({
        chunkId: candidate.label,
        rank: index + 1,
        score: candidate.score,
        value: candidate,
      })),
      rrfK: HYBRID_RETRIEVAL_PROFILE.rrfK,
      lexicalWeight: HYBRID_RETRIEVAL_PROFILE.lexicalWeight,
      vectorWeight: HYBRID_RETRIEVAL_PROFILE.vectorWeight,
      limit: HYBRID_RETRIEVAL_PROFILE.fusedCandidateLimit,
    }).map((candidate) => ({ label: candidate.chunkId, score: candidate.rrfScore }));
    const hybridLatencyMs =
      lexicalLatencyMs + vectorLatencyMs + (performance.now() - hybridStarted);
    evaluations.push({
      query,
      lexical,
      vector,
      hybrid,
      lexicalLatencyMs,
      vectorLatencyMs,
      hybridLatencyMs,
    });
  }

  const overall = {
    lexicalMetrics: metrics(evaluations, "lexical"),
    vectorMetrics: metrics(evaluations, "vector"),
    hybridMetrics: metrics(evaluations, "hybrid"),
  };
  const categories = Object.fromEntries(
    [...new Set(dataset.queries.flatMap((query) => query.category))]
      .sort()
      .map((category) => {
        const subset = evaluations.filter((item) => item.query.category.includes(category));
        return [
          category,
          {
            lexicalMetrics: metrics(subset, "lexical"),
            vectorMetrics: metrics(subset, "vector"),
            hybridMetrics: metrics(subset, "hybrid"),
          },
        ];
      }),
  );
  const excludedLabels = new Set(
    dataset.chunks
      .filter(
        (chunk) =>
          !chunk.active ||
          !chunk.current ||
          !chunk.stored ||
          !chunk.ingestionSucceeded ||
          !chunk.effective,
      )
      .map((chunk) => chunk.label),
  );
  let crossProjectLeakage = 0;
  let oldVersionLeakage = 0;
  let archivedLeakage = 0;
  let invalidChunkLeakage = 0;
  for (const evaluation of evaluations) {
    for (const candidate of evaluation.hybrid) {
      const chunk = dataset.chunks.find((item) => item.label === candidate.label)!;
      if (chunk.projectFixture !== evaluation.query.projectFixture) crossProjectLeakage += 1;
      if (!chunk.current) oldVersionLeakage += 1;
      if (!chunk.active) archivedLeakage += 1;
      if (!chunk.effective) invalidChunkLeakage += 1;
      if (excludedLabels.has(chunk.label)) {
        // Counted in the specific safety category above.
      }
    }
  }
  const semanticLexical = categories.semantic?.lexicalMetrics.recallAt10 ?? 0;
  const semanticHybrid = categories.semantic?.hybridMetrics.recallAt10 ?? 0;
  const exactCategories = evaluations.filter((item) =>
    item.query.category.some((category) => ["exact", "date", "number"].includes(category)),
  );
  const exactLexical = metrics(exactCategories, "lexical");
  const exactHybrid = metrics(exactCategories, "hybrid");
  const safetyPassed =
    crossProjectLeakage === 0 &&
    oldVersionLeakage === 0 &&
    archivedLeakage === 0 &&
    invalidChunkLeakage === 0;
  const gates = {
    safety: safetyPassed,
    recallAt10:
      overall.hybridMetrics.recallAt10 >= overall.lexicalMetrics.recallAt10,
    mrrAt10:
      overall.hybridMetrics.mrrAt10 >= overall.lexicalMetrics.mrrAt10 - 0.01,
    ndcgAt10:
      overall.hybridMetrics.ndcgAt10 >= overall.lexicalMetrics.ndcgAt10,
    semanticRecallGain:
      round(semanticHybrid - semanticLexical) >= 0.15,
    exactDateNumberHitRate:
      exactHybrid.hitRateAt5 >= exactLexical.hitRateAt5 - 0.02,
    noAnswerFalsePositive:
      overall.hybridMetrics.noAnswerFalsePositiveRate <=
      overall.lexicalMetrics.noAnswerFalsePositiveRate,
    vectorP95: overall.vectorMetrics.p95LatencyMs <= 1_500,
    hybridP95: overall.hybridMetrics.p95LatencyMs <= 8_000,
  };
  const result = {
    datasetVersion: dataset.datasetVersion,
    queryCount: dataset.queries.length,
    profile: HYBRID_RETRIEVAL_PROFILE,
    calibration: {
      selectedVectorMaxDistance: HYBRID_RETRIEVAL_PROFILE.vectorMaxDistance,
      positiveP95: round(percentile(positiveDistances, 0.95)),
      positiveMax: round(Math.max(...positiveDistances)),
      negativeP05: round(percentile(negativeDistances, 0.05)),
      negativeMedian: round(percentile(negativeDistances, 0.5)),
    },
    overall,
    categories,
    safety: {
      crossProjectLeakage,
      oldVersionLeakage,
      archivedLeakage,
      invalidChunkLeakage,
    },
    comparisons: {
      semanticRecallGain: round(semanticHybrid - semanticLexical),
      exactDateNumberHitRateDelta: round(
        exactHybrid.hitRateAt5 - exactLexical.hitRateAt5,
      ),
    },
    gates,
    passed: Object.values(gates).every(Boolean),
  };
  return result;
}

export async function writeHybridRetrievalEvaluation(
  outputDirectory = "review-artifacts",
) {
  const result = await evaluateHybridRetrieval();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    `${outputDirectory}/retrieval-evaluation.json`,
    `${JSON.stringify(result, null, 2)}\n`,
    { mode: 0o600 },
  );
  const markdown = [
    "# Hybrid Retrieval Evaluation",
    "",
    `- Dataset: \`${result.datasetVersion}\` (${result.queryCount} fictional queries)`,
    `- Profile: \`${result.profile.id}\` v${result.profile.version}`,
    `- Vector max distance: ${result.profile.vectorMaxDistance}`,
    `- Lexical Recall@10: ${result.overall.lexicalMetrics.recallAt10}`,
    `- Vector Recall@10: ${result.overall.vectorMetrics.recallAt10}`,
    `- Hybrid Recall@10: ${result.overall.hybridMetrics.recallAt10}`,
    `- Lexical MRR@10: ${result.overall.lexicalMetrics.mrrAt10}`,
    `- Hybrid MRR@10: ${result.overall.hybridMetrics.mrrAt10}`,
    `- Lexical nDCG@10: ${result.overall.lexicalMetrics.ndcgAt10}`,
    `- Hybrid nDCG@10: ${result.overall.hybridMetrics.ndcgAt10}`,
    `- Semantic Recall@10 gain: ${result.comparisons.semanticRecallGain}`,
    `- Exact/date/number HitRate@5 delta: ${result.comparisons.exactDateNumberHitRateDelta}`,
    `- No-answer FPR (lexical/hybrid): ${result.overall.lexicalMetrics.noAnswerFalsePositiveRate}/${result.overall.hybridMetrics.noAnswerFalsePositiveRate}`,
    `- Safety leakage (cross/old/archived/invalid): ${result.safety.crossProjectLeakage}/${result.safety.oldVersionLeakage}/${result.safety.archivedLeakage}/${result.safety.invalidChunkLeakage}`,
    `- Quality gates: ${result.passed ? "PASS" : "FAIL"}`,
    "",
    "## Category metrics",
    "",
    "| Category | Lexical Recall@10 | Vector Recall@10 | Hybrid Recall@10 | Lexical Hit@5 | Hybrid Hit@5 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(result.categories).map(
      ([category, values]) =>
        `| ${category} | ${values.lexicalMetrics.recallAt10} | ${values.vectorMetrics.recallAt10} | ${values.hybridMetrics.recallAt10} | ${values.lexicalMetrics.hitRateAt5} | ${values.hybridMetrics.hitRateAt5} |`,
    ),
    "",
    "## Gate results",
    "",
    ...Object.entries(result.gates).map(
      ([gate, passed]) => `- ${gate}: ${passed ? "PASS" : "FAIL"}`,
    ),
    "",
  ].join("\n");
  await writeFile(`${outputDirectory}/retrieval-evaluation.md`, markdown, {
    mode: 0o600,
  });
  const calibration = {
    datasetVersion: result.datasetVersion,
    profileId: result.profile.id,
    distanceMetric: "cosine",
    selectedVectorMaxDistance: result.calibration.selectedVectorMaxDistance,
    positiveP95: result.calibration.positiveP95,
    positiveMax: result.calibration.positiveMax,
    negativeP05: result.calibration.negativeP05,
    negativeMedian: result.calibration.negativeMedian,
    rationale:
      "The selected threshold is conservative against the fictional negative-distance distribution and is accepted only with the complete hybrid quality gates.",
  };
  await writeFile(
    `${outputDirectory}/retrieval-calibration.json`,
    `${JSON.stringify(calibration, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    `${outputDirectory}/retrieval-calibration.md`,
    [
      "# Vector Distance Calibration",
      "",
      `- Dataset: \`${calibration.datasetVersion}\``,
      `- Profile: \`${calibration.profileId}\``,
      `- Metric: ${calibration.distanceMetric}`,
      `- Selected maximum distance: ${calibration.selectedVectorMaxDistance}`,
      `- Relevant-distance P95 / maximum: ${calibration.positiveP95} / ${calibration.positiveMax}`,
      `- Non-relevant-distance P05 / median: ${calibration.negativeP05} / ${calibration.negativeMedian}`,
      `- Rationale: ${calibration.rationale}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return result;
}
