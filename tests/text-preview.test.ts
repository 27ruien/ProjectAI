import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeTextPreview } from "../lib/files/text-preview";
import { FileOperationError } from "../lib/files/errors";

describe("strict text preview decoding", () => {
  it("keeps UTF-8 Chinese and Markdown unchanged", () => {
    const bytes = new TextEncoder().encode("# 项目背景\n\n- 中文内容\n- English");
    const result = decodeTextPreview(bytes);
    assert.equal(result.detectedEncoding, "utf-8");
    assert.equal(result.content, "# 项目背景\n\n- 中文内容\n- English");
    assert.equal(result.content.includes("�"), false);
  });

  it("recognizes a UTF-8 BOM without exposing it", () => {
    const content = new TextEncoder().encode("需求概览");
    const result = decodeTextPreview(Uint8Array.from([0xef, 0xbb, 0xbf, ...content]));
    assert.equal(result.detectedEncoding, "utf-8-bom");
    assert.equal(result.content, "需求概览");
  });

  it("uses GB18030 only after strict UTF-8 fails", () => {
    // “中文”的 GB18030/GBK byte sequence.
    const result = decodeTextPreview(Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]));
    assert.equal(result.detectedEncoding, "gb18030");
    assert.equal(result.content, "中文");
  });

  it("rejects undecodable bytes instead of inserting replacement characters", () => {
    assert.throws(
      () => decodeTextPreview(Uint8Array.from([0x81])),
      (error) =>
        error instanceof FileOperationError &&
        error.code === "FILE_ENCODING_UNSUPPORTED",
    );
  });
});
