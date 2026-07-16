import { parentPort, workerData } from "node:worker_threads";
import type { SupportedFileExtension } from "@/lib/files/config";
import { createDeterministicChunks } from "./chunker";
import type { DocumentProcessingConfig } from "./config";
import {
  DocumentProcessingError,
  type DocumentProcessingFailureCode,
} from "./errors";
import { parseDocumentBytes } from "./parsers";

type ParserWorkerData = {
  bytes: ArrayBuffer;
  extension: SupportedFileExtension;
  config: DocumentProcessingConfig;
};

async function main(): Promise<void> {
  const input = workerData as ParserWorkerData;
  const parsed = await parseDocumentBytes({
    bytes: new Uint8Array(input.bytes),
    extension: input.extension,
    config: input.config,
  });
  const chunks = createDeterministicChunks(parsed.sections, input.config);
  parentPort?.postMessage({ ok: true, parsed, chunks });
}

main().catch((error: unknown) => {
  const processingError =
    error instanceof DocumentProcessingError
      ? error
      : new DocumentProcessingError(
          "DOCUMENT_PARSE_FAILED",
          "Document parser failed.",
        );
  parentPort?.postMessage({
    ok: false,
    code: processingError.code satisfies DocumentProcessingFailureCode,
    message: processingError.message,
    retryable: processingError.retryable,
  });
});
