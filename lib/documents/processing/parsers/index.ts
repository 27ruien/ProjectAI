import type { SupportedFileExtension } from "@/lib/files/config";
import type { DocumentProcessingConfig } from "../config";
import { DocumentProcessingError } from "../errors";
import type { ParsedDocument } from "../types";
import { parseDocxDocument } from "./docx";
import { parsePdfDocument } from "./pdf";
import { parsePptxDocument } from "./pptx";
import { parseMarkdownDocument, parseTextDocument } from "./text";
import { parseXlsxDocument } from "./xlsx";

export async function parseDocumentBytes(input: {
  bytes: Uint8Array;
  extension: SupportedFileExtension;
  config: DocumentProcessingConfig;
}): Promise<ParsedDocument> {
  const { bytes, extension, config } = input;
  let result: ParsedDocument;
  switch (extension) {
    case "pdf":
      result = await parsePdfDocument(bytes, config);
      break;
    case "docx":
      result = await parseDocxDocument(bytes, config);
      break;
    case "xlsx":
      result = await parseXlsxDocument(bytes, config);
      break;
    case "pptx":
      result = await parsePptxDocument(bytes, config);
      break;
    case "txt":
      result = parseTextDocument(bytes, config);
      break;
    case "md":
      result = parseMarkdownDocument(bytes, config);
      break;
    default:
      throw new DocumentProcessingError(
        "INVALID_DOCUMENT_STRUCTURE",
        "Unsupported document parser.",
      );
  }
  if (!result.sections.length) {
    throw new DocumentProcessingError(
      extension === "pdf" ? "OCR_REQUIRED" : "DOCUMENT_PARSE_FAILED",
      "Document contains no indexable text.",
    );
  }
  if (result.sections.length > config.maxSections) {
    throw new DocumentProcessingError(
      "DOCUMENT_TOO_COMPLEX",
      "Document section count exceeds the processing limit.",
    );
  }
  return result;
}
