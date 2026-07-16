import type { SourceLocator } from "./source-locator";

export type ParsedSectionType =
  | "page"
  | "heading"
  | "paragraph_group"
  | "table"
  | "sheet_range"
  | "slide"
  | "notes"
  | "text_block"
  | "code_block"
  | "list";

export type ParsedSection = {
  sectionType: ParsedSectionType;
  heading?: string | null;
  headingPath: string[];
  pageNumber?: number | null;
  slideNumber?: number | null;
  sheetName?: string | null;
  columnStart?: number | null;
  columnEnd?: number | null;
  rowStart?: number | null;
  rowEnd?: number | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  sourceLocator: SourceLocator;
  content: string;
};

export type ParsedDocument = {
  sections: ParsedSection[];
  totalCharacters: number;
};

export type DeterministicChunk = {
  sectionIndex: number;
  chunkIndex: number;
  content: string;
  contentSha256: string;
  searchText: string;
  characterCount: number;
  estimatedTokenCount: number;
  headingPath: string[];
  sourceLocator: SourceLocator;
};
