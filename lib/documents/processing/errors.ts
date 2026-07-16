export type DocumentProcessingFailureCode =
  | "DOCUMENT_PARSE_FAILED"
  | "DOCUMENT_PARSE_TIMEOUT"
  | "DOCUMENT_TOO_COMPLEX"
  | "DOCUMENT_TOO_MANY_PAGES"
  | "DOCUMENT_TOO_MANY_SLIDES"
  | "DOCUMENT_TOO_MANY_SHEETS"
  | "DOCUMENT_TOO_MANY_ROWS"
  | "DOCUMENT_TOO_MANY_CELLS"
  | "DOCUMENT_TOO_MUCH_TEXT"
  | "INVALID_DOCUMENT_STRUCTURE"
  | "FILE_INTEGRITY_MISMATCH"
  | "OBJECT_READ_FAILED"
  | "OCR_REQUIRED"
  | "WORKER_LEASE_LOST"
  | "WORKER_MAX_ATTEMPTS_REACHED";

export class DocumentProcessingError extends Error {
  constructor(
    public readonly code: DocumentProcessingFailureCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "DocumentProcessingError";
  }
}

export function publicProcessingFailureMessage(
  code: DocumentProcessingFailureCode,
): string {
  const messages: Record<DocumentProcessingFailureCode, string> = {
    DOCUMENT_PARSE_FAILED: "文档解析失败",
    DOCUMENT_PARSE_TIMEOUT: "文档解析超时",
    DOCUMENT_TOO_COMPLEX: "文档结构超过处理上限",
    DOCUMENT_TOO_MANY_PAGES: "PDF 页数超过处理上限",
    DOCUMENT_TOO_MANY_SLIDES: "演示文稿页数超过处理上限",
    DOCUMENT_TOO_MANY_SHEETS: "工作表数量超过处理上限",
    DOCUMENT_TOO_MANY_ROWS: "工作表行数超过处理上限",
    DOCUMENT_TOO_MANY_CELLS: "工作表单元格数量超过处理上限",
    DOCUMENT_TOO_MUCH_TEXT: "文档文字量超过处理上限",
    INVALID_DOCUMENT_STRUCTURE: "文档结构无效",
    FILE_INTEGRITY_MISMATCH: "文件完整性校验失败",
    OBJECT_READ_FAILED: "文件读取暂时失败",
    OCR_REQUIRED: "该 PDF 需要 OCR",
    WORKER_LEASE_LOST: "解析任务租约已失效",
    WORKER_MAX_ATTEMPTS_REACHED: "解析任务已达到最大重试次数",
  };
  return messages[code];
}
