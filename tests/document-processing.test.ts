import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDeterministicChunks } from "../lib/documents/processing/chunker";
import type { DocumentProcessingConfig } from "../lib/documents/processing/config";
import { DocumentProcessingError } from "../lib/documents/processing/errors";
import { parseDocumentBytes } from "../lib/documents/processing/parsers";
import { parseDocumentWithTimeout } from "../lib/documents/processing/parse-with-timeout";
import { validateSourceLocator } from "../lib/documents/processing/source-locator";
import type { ParsedSection } from "../lib/documents/processing/types";
import {
  createMarkdownFixture,
  createScannedPdfFixture,
  createSearchableDocxFixture,
  createSearchablePdfFixture,
  createSearchablePptxFixture,
  createSearchableXlsxFixture,
  createTextFixture,
  fileBytes,
} from "./helpers/file-fixtures";

const config: DocumentProcessingConfig = {
  pollMs: 10,
  leaseSeconds: 30,
  maxAttempts: 3,
  maxPages: 10,
  maxSlides: 10,
  maxSheets: 10,
  maxRows: 100,
  maxColumns: 50,
  maxCells: 1_000,
  maxCharacters: 100_000,
  maxSections: 1_000,
  maxChunks: 1_000,
  parseTimeoutMs: 10_000,
  chunkTargetChars: 80,
  chunkOverlapChars: 15,
  chunkMinChars: 20,
  parserVersion: "1",
  chunkerVersion: "1",
};

async function expectProcessingError(
  operation: Promise<unknown>,
  code: DocumentProcessingError["code"],
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof DocumentProcessingError && error.code === code,
  );
}

describe("document parsers", () => {
  it("extracts PDF text with page source location", async () => {
    const parsed = await parseDocumentBytes({
      bytes: await fileBytes(createSearchablePdfFixture()),
      extension: "pdf",
      config,
    });
    assert.equal(parsed.sections[0]?.pageNumber, 1);
    assert.equal(parsed.sections[0]?.sourceLocator.type, "pdf_page");
    assert.match(parsed.sections[0]?.content ?? "", /Launch date/);
  });

  it("marks a textless PDF as OCR required", async () => {
    await expectProcessingError(
      parseDocumentBytes({
        bytes: await fileBytes(createScannedPdfFixture()),
        extension: "pdf",
        config,
      }),
      "OCR_REQUIRED",
    );
  });

  it("fails closed for corrupt, oversized-page, and excessive-text PDFs", async () => {
    const corrupt = new File(
      ["%PDF-1.4\nFICTITIOUS CORRUPT PDF\n%%EOF\n"],
      "corrupt.pdf",
      { type: "application/pdf" },
    );
    await expectProcessingError(
      parseDocumentBytes({
        bytes: await fileBytes(corrupt),
        extension: "pdf",
        config,
      }),
      "DOCUMENT_PARSE_FAILED",
    );
    const validBytes = await fileBytes(createSearchablePdfFixture());
    await expectProcessingError(
      parseDocumentBytes({
        bytes: validBytes,
        extension: "pdf",
        config: { ...config, maxPages: 0 },
      }),
      "DOCUMENT_TOO_MANY_PAGES",
    );
    await expectProcessingError(
      parseDocumentBytes({
        bytes: validBytes,
        extension: "pdf",
        config: { ...config, maxCharacters: 10 },
      }),
      "DOCUMENT_TOO_MUCH_TEXT",
    );
  });

  it("extracts DOCX headings, paragraphs, lists, and tables", async () => {
    const parsed = await parseDocumentBytes({
      bytes: await fileBytes(createSearchableDocxFixture()),
      extension: "docx",
      config,
    });
    assert.ok(parsed.sections.some((section) => section.sectionType === "heading"));
    assert.ok(parsed.sections.some((section) => section.sectionType === "list"));
    assert.ok(parsed.sections.some((section) => section.sectionType === "table"));
    assert.deepEqual(parsed.sections.at(-1)?.headingPath, ["Timeline"]);
    assert.match(parsed.sections.map((section) => section.content).join("\n"), /100,000/);
  });

  it("enforces DOCX section and character limits", async () => {
    const bytes = await fileBytes(createSearchableDocxFixture());
    await expectProcessingError(
      parseDocumentBytes({
        bytes,
        extension: "docx",
        config: { ...config, maxSections: 1 },
      }),
      "DOCUMENT_TOO_COMPLEX",
    );
    await expectProcessingError(
      parseDocumentBytes({
        bytes,
        extension: "docx",
        config: { ...config, maxCharacters: 10 },
      }),
      "DOCUMENT_TOO_MUCH_TEXT",
    );
  });

  it("extracts XLSX sheet and row/column ranges without calculating formulas", async () => {
    const parsed = await parseDocumentBytes({
      bytes: await fileBytes(createSearchableXlsxFixture()),
      extension: "xlsx",
      config,
    });
    assert.equal(parsed.sections[0]?.sheetName, "Budget");
    assert.equal(parsed.sections[0]?.rowStart, 1);
    assert.equal(parsed.sections[0]?.columnEnd, 2);
    assert.match(parsed.sections[1]?.content ?? "", /October 15/);
  });

  it("enforces XLSX row, column, and cell limits", async () => {
    const bytes = await fileBytes(createSearchableXlsxFixture());
    await expectProcessingError(
      parseDocumentBytes({
        bytes,
        extension: "xlsx",
        config: { ...config, maxRows: 1 },
      }),
      "DOCUMENT_TOO_MANY_ROWS",
    );
    await expectProcessingError(
      parseDocumentBytes({
        bytes,
        extension: "xlsx",
        config: { ...config, maxColumns: 1 },
      }),
      "DOCUMENT_TOO_COMPLEX",
    );
    await expectProcessingError(
      parseDocumentBytes({
        bytes,
        extension: "xlsx",
        config: { ...config, maxCells: 1 },
      }),
      "DOCUMENT_TOO_MANY_CELLS",
    );
  });

  it("extracts PPTX slide text and slide number", async () => {
    const parsed = await parseDocumentBytes({
      bytes: await fileBytes(createSearchablePptxFixture()),
      extension: "pptx",
      config,
    });
    assert.equal(parsed.sections[0]?.slideNumber, 1);
    assert.match(parsed.sections[0]?.content ?? "", /Milestone/);
  });

  it("enforces the PPTX slide limit", async () => {
    await expectProcessingError(
      parseDocumentBytes({
        bytes: await fileBytes(createSearchablePptxFixture()),
        extension: "pptx",
        config: { ...config, maxSlides: 0 },
      }),
      "DOCUMENT_TOO_MANY_SLIDES",
    );
  });

  it("parses TXT and Markdown as inert UTF-8 text", async () => {
    const text = await parseDocumentBytes({
      bytes: await fileBytes(
        createTextFixture(
          "aurora.txt",
          "\uFEFFProject Aurora\nLaunch date: October 15",
        ),
      ),
      extension: "txt",
      config,
    });
    const markdown = await parseDocumentBytes({
      bytes: await fileBytes(
        createMarkdownFixture(
          "aurora.md",
          "requirement\n\n```js\nalert('not executed')\n```",
        ),
      ),
      extension: "md",
      config,
    });
    assert.match(text.sections[0]?.content ?? "", /Project Aurora/);
    assert.equal(text.sections[0]?.content.startsWith("\uFEFF"), false);
    assert.equal(text.sections[0]?.lineStart, 1);
    assert.equal(text.sections[0]?.lineEnd, 2);
    assert.ok(
      markdown.sections.some((section) => section.sectionType === "code_block"),
    );
  });

  it("rejects non-UTF-8 and excessive text while keeping Markdown HTML and remote URLs inert", async () => {
    await expectProcessingError(
      parseDocumentBytes({
        bytes: new Uint8Array([0xff, 0xfe, 0xfd]),
        extension: "txt",
        config,
      }),
      "INVALID_DOCUMENT_STRUCTURE",
    );
    await expectProcessingError(
      parseDocumentBytes({
        bytes: new TextEncoder().encode("0123456789"),
        extension: "txt",
        config: { ...config, maxCharacters: 5 },
      }),
      "DOCUMENT_TOO_MUCH_TEXT",
    );
    const markdown = await parseDocumentBytes({
      bytes: new TextEncoder().encode(
        "# Safety\n\n<script>globalThis.compromised = true</script>\n\n![remote](https://invalid.example/test.png)\n",
      ),
      extension: "md",
      config,
    });
    assert.deepEqual(markdown.sections.at(-1)?.headingPath, ["Safety"]);
    assert.match(
      markdown.sections.map((section) => section.content).join("\n"),
      /invalid\.example/,
    );
    assert.equal(
      (globalThis as typeof globalThis & { compromised?: boolean }).compromised,
      undefined,
    );
  });
});

describe("deterministic document chunking", () => {
  it("keeps stable ordering, hashes, heading paths, and source locators", async () => {
    const parsed = await parseDocumentBytes({
      bytes: await fileBytes(createSearchableDocxFixture()),
      extension: "docx",
      config,
    });
    const first = createDeterministicChunks(parsed.sections, config);
    const second = createDeterministicChunks(parsed.sections, config);
    assert.deepEqual(first, second);
    assert.ok(first.every((chunk) => chunk.content.trim().length > 0));
    assert.ok(first.every((chunk) => /^[0-9a-f]{64}$/.test(chunk.contentSha256)));
    assert.ok(first.every((chunk) => chunk.sourceLocator.type === "docx_section"));
  });

  it("keeps chunks within their source Section and enforces the chunk limit", () => {
    const sections: ParsedSection[] = [
      {
        sectionType: "slide",
        headingPath: ["Slide A"],
        slideNumber: 1,
        sourceLocator: validateSourceLocator({
          type: "pptx_slide",
          slideNumber: 1,
        }),
        content:
          "Alpha sentence one. Alpha sentence two. Alpha sentence three. Alpha sentence four.",
      },
      {
        sectionType: "slide",
        headingPath: ["Slide B"],
        slideNumber: 2,
        sourceLocator: validateSourceLocator({
          type: "pptx_slide",
          slideNumber: 2,
        }),
        content: "Beta content remains isolated from the first slide.",
      },
    ];
    const bounded = {
      ...config,
      chunkTargetChars: 40,
      chunkOverlapChars: 10,
      chunkMinChars: 10,
    };
    const chunks = createDeterministicChunks(sections, bounded);
    assert.ok(chunks.length > 2);
    assert.ok(
      chunks.every(
        (chunk) =>
          chunk.characterCount <=
          bounded.chunkTargetChars + bounded.chunkOverlapChars,
      ),
    );
    assert.ok(
      chunks
        .filter((chunk) => chunk.sectionIndex === 0)
        .every((chunk) => chunk.sourceLocator.type === "pptx_slide" && chunk.sourceLocator.slideNumber === 1),
    );
    assert.ok(
      chunks
        .filter((chunk) => chunk.sectionIndex === 1)
        .every((chunk) => chunk.sourceLocator.type === "pptx_slide" && chunk.sourceLocator.slideNumber === 2),
    );
    assert.throws(
      () =>
        createDeterministicChunks(sections, {
          ...bounded,
          maxChunks: 1,
        }),
      (error: unknown) =>
        error instanceof DocumentProcessingError &&
        error.code === "DOCUMENT_TOO_COMPLEX",
    );
  });

  it("runs parsing in a terminable worker thread", async () => {
    const result = await parseDocumentWithTimeout({
      bytes: await fileBytes(createSearchablePdfFixture()),
      extension: "pdf",
      config,
    });
    assert.ok(result.parsed.sections.length > 0);
    assert.ok(result.chunks.some((chunk) => /October 15/.test(chunk.content)));
  });

  it("terminates parser work after the configured hard timeout", async () => {
    await expectProcessingError(
      parseDocumentWithTimeout({
        bytes: await fileBytes(createSearchablePdfFixture()),
        extension: "pdf",
        config: { ...config, parseTimeoutMs: 1 },
      }),
      "DOCUMENT_PARSE_TIMEOUT",
    );
  });
});
