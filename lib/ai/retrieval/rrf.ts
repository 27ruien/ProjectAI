export type RankedRetrievalCandidate<T> = {
  chunkId: string;
  rank: number;
  score: number;
  value: T;
};

export type FusedRetrievalCandidate<T> = {
  chunkId: string;
  candidateSource: "lexical" | "vector" | "both";
  lexicalRank: number | null;
  lexicalScore: number | null;
  vectorRank: number | null;
  vectorDistance: number | null;
  rrfScore: number;
  finalRank: number;
  value: T;
};

export type AuditedRetrievalCandidate<T> = Omit<
  FusedRetrievalCandidate<T>,
  "finalRank"
> & {
  finalRank: number | null;
};

export function reciprocalRankFusionAudit<T>(input: {
  lexical: RankedRetrievalCandidate<T>[];
  vector: RankedRetrievalCandidate<T>[];
  rrfK: number;
  lexicalWeight: number;
  vectorWeight: number;
  limit: number;
}): AuditedRetrievalCandidate<T>[] {
  const byChunk = new Map<
    string,
    Omit<FusedRetrievalCandidate<T>, "finalRank" | "rrfScore">
  >();
  for (const candidate of input.lexical) {
    if (byChunk.has(candidate.chunkId)) continue;
    byChunk.set(candidate.chunkId, {
      chunkId: candidate.chunkId,
      candidateSource: "lexical",
      lexicalRank: candidate.rank,
      lexicalScore: candidate.score,
      vectorRank: null,
      vectorDistance: null,
      value: candidate.value,
    });
  }
  for (const candidate of input.vector) {
    const existing = byChunk.get(candidate.chunkId);
    if (existing) {
      existing.candidateSource = "both";
      existing.vectorRank = candidate.rank;
      existing.vectorDistance = candidate.score;
    } else {
      byChunk.set(candidate.chunkId, {
        chunkId: candidate.chunkId,
        candidateSource: "vector",
        lexicalRank: null,
        lexicalScore: null,
        vectorRank: candidate.rank,
        vectorDistance: candidate.score,
        value: candidate.value,
      });
    }
  }
  const missingRank = Number.MAX_SAFE_INTEGER;
  return [...byChunk.values()]
    .map((candidate) => ({
      ...candidate,
      rrfScore:
        (candidate.lexicalRank === null
          ? 0
          : input.lexicalWeight / (input.rrfK + candidate.lexicalRank)) +
        (candidate.vectorRank === null
          ? 0
          : input.vectorWeight / (input.rrfK + candidate.vectorRank)),
    }))
    .sort(
      (left, right) =>
        right.rrfScore - left.rrfScore ||
        Number(right.candidateSource === "both") -
          Number(left.candidateSource === "both") ||
        (left.lexicalRank ?? missingRank) -
          (right.lexicalRank ?? missingRank) ||
        (left.vectorRank ?? missingRank) - (right.vectorRank ?? missingRank) ||
        left.chunkId.localeCompare(right.chunkId),
    )
    .map((candidate, index) => ({
      ...candidate,
      finalRank: index < Math.max(0, input.limit) ? index + 1 : null,
    }));
}

export function reciprocalRankFusion<T>(input: {
  lexical: RankedRetrievalCandidate<T>[];
  vector: RankedRetrievalCandidate<T>[];
  rrfK: number;
  lexicalWeight: number;
  vectorWeight: number;
  limit: number;
}): FusedRetrievalCandidate<T>[] {
  return reciprocalRankFusionAudit(input).filter(
    (candidate): candidate is FusedRetrievalCandidate<T> =>
      candidate.finalRank !== null,
  );
}
