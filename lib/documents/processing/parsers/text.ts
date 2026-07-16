import type { DocumentProcessingConfig } from "../config";
import { DocumentProcessingError } from "../errors";
import { validateSourceLocator } from "../source-locator";
import type { ParsedDocument, ParsedSection } from "../types";

function decodeUtf8(bytes: Uint8Array): string {
  try {
    const offset =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(offset));
  } catch {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "Text document is not valid UTF-8.",
    );
  }
}

function enforceCharacters(text: string, config: DocumentProcessingConfig): void {
  if (text.length > config.maxCharacters) {
    throw new DocumentProcessingError(
      "DOCUMENT_TOO_MUCH_TEXT",
      "Document text exceeds the processing limit.",
    );
  }
}

export function parseTextDocument(
  bytes: Uint8Array,
  config: DocumentProcessingConfig,
): ParsedDocument {
  const text = decodeUtf8(bytes).replace(/\r\n?/g, "\n");
  enforceCharacters(text, config);
  const lines = text.split("\n");
  const sections: ParsedSection[] = [];
  let start = 0;
  const flush = (end: number) => {
    const content = lines.slice(start, end).join("\n").trim();
    if (content) {
      const lineStart = start + 1;
      const lineEnd = end;
      sections.push({
        sectionType: "text_block",
        headingPath: [],
        lineStart,
        lineEnd,
        sourceLocator: validateSourceLocator({
          type: "text_lines",
          lineStart,
          lineEnd,
        }),
        content,
      });
    }
    start = end + 1;
  };
  for (let index = 0; index <= lines.length; index += 1) {
    if (index === lines.length || lines[index]?.trim() === "") flush(index);
  }
  return { sections, totalCharacters: text.length };
}

type MarkdownBlock = {
  type: ParsedSection["sectionType"];
  content: string;
  start: number;
  end: number;
  headingPath: string[];
  heading?: string;
};

export function parseMarkdownDocument(
  bytes: Uint8Array,
  config: DocumentProcessingConfig,
): ParsedDocument {
  const text = decodeUtf8(bytes).replace(/\r\n?/g, "\n");
  enforceCharacters(text, config);
  const lines = text.split("\n");
  const headingStack: string[] = [];
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1]!.length;
      const title = heading[2]!.trim();
      headingStack.splice(level - 1);
      headingStack[level - 1] = title;
      blocks.push({
        type: "heading",
        content: title,
        start: index + 1,
        end: index + 1,
        headingPath: [...headingStack],
        heading: title,
      });
      index += 1;
      continue;
    }
    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const marker = fence[1]![0]!;
      const start = index;
      index += 1;
      while (
        index < lines.length &&
        !new RegExp(`^\\s*${marker}{${fence[1]!.length},}\\s*$`).test(
          lines[index] ?? "",
        )
      ) {
        index += 1;
      }
      if (index < lines.length) index += 1;
      const content = lines.slice(start, index).join("\n").trim();
      if (content) {
        blocks.push({
          type: "code_block",
          content,
          start: start + 1,
          end: index,
          headingPath: [...headingStack],
        });
      }
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const start = index;
    const isList = /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
    const isQuote = /^\s*>/.test(line);
    const isTable =
      line.includes("|") && (lines[index + 1] ?? "").match(/^\s*\|?[\s:|-]+\|/);
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (!next.trim() || /^(#{1,6})\s+/.test(next) || /^\s*(```+|~~~+)/.test(next)) {
        break;
      }
      if (isList && !/^\s*(?:[-+*]|\d+[.)])\s+/.test(next)) break;
      if (isQuote && !/^\s*>/.test(next)) break;
      if (isTable && !next.includes("|")) break;
      index += 1;
    }
    const content = lines.slice(start, index).join("\n").trim();
    blocks.push({
      type: isList ? "list" : isTable ? "table" : "paragraph_group",
      content,
      start: start + 1,
      end: index,
      headingPath: [...headingStack],
    });
  }
  const sections = blocks.map<ParsedSection>((block) => ({
    sectionType: block.type,
    heading: block.heading,
    headingPath: block.headingPath,
    lineStart: block.start,
    lineEnd: block.end,
    sourceLocator: validateSourceLocator({
      type: "markdown_section",
      headingPath: block.headingPath,
      lineStart: block.start,
      lineEnd: block.end,
    }),
    content: block.content,
  }));
  return { sections, totalCharacters: text.length };
}
