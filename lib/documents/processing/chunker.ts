import { createHash } from "node:crypto";
import type { DocumentProcessingConfig } from "./config";
import { DocumentProcessingError } from "./errors";
import type {
  DeterministicChunk,
  ParsedSection,
} from "./types";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function boundaries(value: string): string[] {
  const paragraphs = value.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const units: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= 600) {
      units.push(paragraph);
      continue;
    }
    const sentences = paragraph
      .split(/(?<=[.!?。！？；;])\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    units.push(...(sentences.length ? sentences : [paragraph]));
  }
  return units;
}

function hardSplit(value: string, target: number): string[] {
  const pieces: string[] = [];
  for (let offset = 0; offset < value.length; offset += target) {
    pieces.push(value.slice(offset, offset + target));
  }
  return pieces;
}

function overlapPrefix(previous: string, maxChars: number): string {
  if (!previous || maxChars < 1) return "";
  const tail = previous.slice(-maxChars);
  const boundary = tail.search(/(?:^|\s|[.!?。！？；;])\S*$/);
  return (boundary >= 0 ? tail.slice(boundary) : tail).trim();
}

function chunksForSection(
  section: ParsedSection,
  config: DocumentProcessingConfig,
): string[] {
  const content = normalizedText(section.content);
  if (content.length <= config.chunkTargetChars) return [content];
  const units = boundaries(content).flatMap((unit) =>
    unit.length > config.chunkTargetChars
      ? hardSplit(unit, config.chunkTargetChars)
      : [unit],
  );
  const chunks: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length <= config.chunkTargetChars || !current) {
      current = candidate;
      continue;
    }
    chunks.push(current.trim());
    const overlap = overlapPrefix(current, config.chunkOverlapChars);
    current = overlap ? `${overlap}\n\n${unit}` : unit;
    if (current.length > config.chunkTargetChars) {
      const split = hardSplit(current, config.chunkTargetChars);
      chunks.push(...split.slice(0, -1).map((part) => part.trim()));
      current = split.at(-1)?.trim() ?? "";
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (
    chunks.length > 1 &&
    chunks.at(-1)!.length < config.chunkMinChars &&
    chunks.at(-2)!.length + chunks.at(-1)!.length + 2 <=
      config.chunkTargetChars + config.chunkOverlapChars
  ) {
    const tail = chunks.pop()!;
    chunks[chunks.length - 1] = `${chunks.at(-1)}\n\n${tail}`;
  }
  return chunks;
}

export function createDeterministicChunks(
  sections: ParsedSection[],
  config: DocumentProcessingConfig,
): DeterministicChunk[] {
  const output: DeterministicChunk[] = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    for (const content of chunksForSection(section, config)) {
      if (!content.trim()) continue;
      if (output.length >= config.maxChunks) {
        throw new DocumentProcessingError(
          "DOCUMENT_TOO_COMPLEX",
          "Document chunk count exceeds the processing limit.",
        );
      }
      const searchText = normalizedText(
        [...section.headingPath, content].filter(Boolean).join("\n"),
      );
      output.push({
        sectionIndex,
        chunkIndex: output.length,
        content,
        contentSha256: sha256(content),
        searchText,
        characterCount: content.length,
        estimatedTokenCount: Math.max(1, Math.ceil(content.length / 4)),
        headingPath: [...section.headingPath],
        sourceLocator: section.sourceLocator,
      });
    }
  }
  if (!output.length) {
    throw new DocumentProcessingError(
      "DOCUMENT_PARSE_FAILED",
      "Document produced no indexable chunks.",
    );
  }
  return output;
}
