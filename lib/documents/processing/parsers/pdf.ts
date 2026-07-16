import type { DocumentProcessingConfig } from "../config";
import { DocumentProcessingError } from "../errors";
import { validateSourceLocator } from "../source-locator";
import type { ParsedDocument, ParsedSection } from "../types";

type PdfTextItem = { str?: string; hasEOL?: boolean };

export async function parsePdfDocument(
  bytes: Uint8Array,
  config: DocumentProcessingConfig,
): Promise<ParsedDocument> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      useSystemFonts: false,
      useWorkerFetch: false,
      useWasm: false,
      disableFontFace: true,
      enableXfa: false,
      stopAtErrors: true,
      verbosity: 0,
    });
    try {
      const document = await loadingTask.promise;
      const pageCount = document.numPages;
      if (pageCount > config.maxPages) {
        throw new DocumentProcessingError(
          "DOCUMENT_TOO_MANY_PAGES",
          "PDF page count exceeds the processing limit.",
        );
      }
      const sections: ParsedSection[] = [];
      let totalCharacters = 0;
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent({
          disableNormalization: false,
          includeMarkedContent: false,
        });
        let content = "";
        for (const rawItem of textContent.items) {
          const item = rawItem as PdfTextItem;
          if (typeof item.str !== "string") continue;
          if (
            content &&
            !content.endsWith("\n") &&
            !/^\s/.test(item.str) &&
            !/\s$/.test(content)
          ) {
            content += " ";
          }
          content += item.str;
          if (item.hasEOL) content += "\n";
        }
        content = content
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        totalCharacters += content.length;
        if (totalCharacters > config.maxCharacters) {
          throw new DocumentProcessingError(
            "DOCUMENT_TOO_MUCH_TEXT",
            "PDF text exceeds the processing limit.",
          );
        }
        if (content) {
          sections.push({
            sectionType: "page",
            headingPath: [],
            pageNumber,
            sourceLocator: validateSourceLocator({
              type: "pdf_page",
              pageNumber,
            }),
            content,
          });
        }
        page.cleanup();
      }
      await document.cleanup();
      const threshold = Math.max(20, pageCount * 5);
      if (totalCharacters < threshold) {
        throw new DocumentProcessingError(
          "OCR_REQUIRED",
          "PDF contains insufficient extractable text.",
        );
      }
      return { sections, totalCharacters };
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    throw new DocumentProcessingError(
      "DOCUMENT_PARSE_FAILED",
      "PDF parser rejected the document.",
    );
  }
}
