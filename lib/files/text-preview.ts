import { FileOperationError } from "./errors";

export type TextPreviewEncoding = "utf-8" | "utf-8-bom" | "gb18030";

export function decodeTextPreview(bytes: Uint8Array): {
  content: string;
  detectedEncoding: TextPreviewEncoding;
  lineCount: number;
} {
  const hasUtf8Bom =
    bytes.byteLength >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf;
  const payload = hasUtf8Bom ? bytes.subarray(3) : bytes;
  const candidates: Array<{ encoding: TextPreviewEncoding; label: string }> = [
    { encoding: hasUtf8Bom ? "utf-8-bom" : "utf-8", label: "utf-8" },
    { encoding: "gb18030", label: "gb18030" },
  ];
  for (const candidate of candidates) {
    try {
      const content = new TextDecoder(candidate.label, { fatal: true })
        .decode(payload)
        .replace(/^\uFEFF/, "");
      if (content.includes("\uFFFD") || /\u0000/.test(content)) continue;
      return {
        content,
        detectedEncoding: candidate.encoding,
        lineCount: content ? content.split(/\r?\n/).length : 0,
      };
    } catch {
      // The next decoder is attempted only after strict decoding failed.
    }
  }
  throw new FileOperationError(
    422,
    "FILE_ENCODING_UNSUPPORTED",
    "无法识别这份文本文件的字符编码，你仍然可以下载原文件",
  );
}
