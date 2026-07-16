import { Worker } from "node:worker_threads";
import type { SupportedFileExtension } from "@/lib/files/config";
import type { DocumentProcessingConfig } from "./config";
import { DocumentProcessingError } from "./errors";
import type {
  DeterministicChunk,
  ParsedDocument,
} from "./types";

type ParserMessage =
  | {
      ok: true;
      parsed: ParsedDocument;
      chunks: DeterministicChunk[];
    }
  | {
      ok: false;
      code: DocumentProcessingError["code"];
      message: string;
      retryable: boolean;
    };

export function parseDocumentWithTimeout(input: {
  bytes: Uint8Array;
  extension: SupportedFileExtension;
  config: DocumentProcessingConfig;
}): Promise<{ parsed: ParsedDocument; chunks: DeterministicChunk[] }> {
  return new Promise((resolve, reject) => {
    const transferable = input.bytes.slice().buffer;
    const worker = new Worker(new URL("./parser-thread.ts", import.meta.url), {
      execArgv: ["--import", "tsx"],
      workerData: {
        bytes: transferable,
        extension: input.extension,
        config: input.config,
      },
      transferList: [transferable],
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => {
        void worker.terminate();
        reject(
          new DocumentProcessingError(
            "DOCUMENT_PARSE_TIMEOUT",
            "Document parser exceeded the time limit.",
            true,
          ),
        );
      });
    }, input.config.parseTimeoutMs);
    timeout.unref();
    worker.once("message", (message: ParserMessage) => {
      finish(() => {
        void worker.terminate();
        if (message.ok) {
          resolve({ parsed: message.parsed, chunks: message.chunks });
        } else {
          reject(
            new DocumentProcessingError(
              message.code,
              message.message,
              message.retryable,
            ),
          );
        }
      });
    });
    worker.once("error", () => {
      finish(() => {
        reject(
          new DocumentProcessingError(
            "DOCUMENT_PARSE_FAILED",
            "Document parser process failed.",
            true,
          ),
        );
      });
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() => {
          reject(
            new DocumentProcessingError(
              "DOCUMENT_PARSE_FAILED",
              "Document parser process exited unexpectedly.",
              true,
            ),
          );
        });
      }
    });
  });
}
