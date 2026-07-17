import type { ProjectKnowledgeEvidence } from "@/lib/documents/processing/search-service";

const evidenceMarker = /\[E(\d{1,3})\]/g;

export type ValidatedGroundedAnswer = {
  text: string;
  citations: Array<{
    index: number;
    evidence: ProjectKnowledgeEvidence;
  }>;
};

export function validateAndMapCitations(
  answer: string,
  evidence: ProjectKnowledgeEvidence[],
): ValidatedGroundedAnswer | null {
  const allowed = new Map(evidence.map((item) => [item.label, item]));
  const orderedLabels: string[] = [];
  for (const match of answer.matchAll(evidenceMarker)) {
    const label = `E${match[1]}`;
    if (!allowed.has(label)) return null;
    if (!orderedLabels.includes(label)) orderedLabels.push(label);
  }
  if (orderedLabels.length === 0) return null;
  const displayIndex = new Map(
    orderedLabels.map((label, index) => [label, index + 1]),
  );
  const text = answer.replace(evidenceMarker, (_marker, number: string) => {
    const index = displayIndex.get(`E${number}`);
    return index ? `[${index}]` : "";
  });
  return {
    text,
    citations: orderedLabels.map((label, index) => ({
      index: index + 1,
      evidence: allowed.get(label)!,
    })),
  };
}
