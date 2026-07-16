import { createHash } from "node:crypto";
import yauzl from "yauzl";
import { allowedUploadExtensions, maxUploadBytes, type SupportedFileExtension } from "./config";
import { FileOperationError } from "./errors";

const MAX_FILENAME_BYTES = 255;
const MAX_DISPLAY_NAME_BYTES = 240;
const MAX_OBJECT_KEY_SEGMENT_LENGTH = 128;
const MAX_OFFICE_ENTRIES = 2_000;
const MAX_OFFICE_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
const MAX_OFFICE_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_OFFICE_TOTAL_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_OFFICE_COMPRESSION_RATIO = 1_000;
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;

const OFFICE_REQUIREMENTS = {
  docx: {
    coreEntry: "word/document.xml",
    partName: "/word/document.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    coreEntry: "xl/workbook.xml",
    partName: "/xl/workbook.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    coreEntry: "ppt/presentation.xml",
    partName: "/ppt/presentation.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
} as const;

const MIME_TYPES: Record<SupportedFileExtension, readonly string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain", "text/x-markdown"],
};

const DETECTED_MIME: Record<SupportedFileExtension, string> = {
  pdf: MIME_TYPES.pdf[0],
  docx: MIME_TYPES.docx[0],
  xlsx: MIME_TYPES.xlsx[0],
  pptx: MIME_TYPES.pptx[0],
  txt: MIME_TYPES.txt[0],
  md: "text/markdown",
};

export type ValidatedUpload = {
  bytes: Uint8Array;
  originalFilename: string;
  displayName: string;
  extension: SupportedFileExtension;
  declaredMimeType: string;
  detectedMimeType: string;
  sizeBytes: number;
  sha256: string;
};

function truncateUtf8(value: string, maxBytes: number): string {
  let byteLength = 0;
  let output = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + characterBytes > maxBytes) break;
    output += character;
    byteLength += characterBytes;
  }
  return output;
}

function truncateFilename(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_FILENAME_BYTES) return value;
  const extensionIndex = value.lastIndexOf(".");
  const suffix =
    extensionIndex > 0 && value.length - extensionIndex <= 16
      ? value.slice(extensionIndex)
      : "";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const stem = suffix ? value.slice(0, extensionIndex) : value;
  return `${truncateUtf8(stem, MAX_FILENAME_BYTES - suffixBytes)}${suffix}`;
}

export function sanitizeOriginalFilename(value: string): string {
  // Compatibility normalization turns full-width separators and dots into
  // their ASCII form before basename extraction. Bidi controls and Unicode
  // noncharacters are removed so stored metadata cannot visually spoof paths.
  const normalized = value
    .normalize("NFKC")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufdd0-\ufdef\ufffe\uffff]/g,
      "",
    );
  const basename = normalized.split(/[\\/]+/).filter(Boolean).at(-1) ?? "file";
  const trimmed = basename.trim().replace(/[.\s]+$/u, "");
  const safe = /^\.+$/u.test(trimmed) ? "file" : trimmed;
  return truncateFilename(safe || "file");
}

function extensionOf(filename: string): SupportedFileExtension | null {
  const index = filename.lastIndexOf(".");
  if (index < 1 || index === filename.length - 1) return null;
  const extension = filename.slice(index + 1).toLowerCase();
  return allowedUploadExtensions().has(extension as SupportedFileExtension)
    ? (extension as SupportedFileExtension)
    : null;
}

function invalidOfficeContainer(): FileOperationError {
  return new FileOperationError(
    415,
    "INVALID_OFFICE_CONTAINER",
    "Office 文件容器无效",
  );
}

function isZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

function isUnsafeZipPath(fileName: string): boolean {
  if (
    !fileName ||
    fileName.includes("\0") ||
    fileName.includes("\\") ||
    fileName.startsWith("/") ||
    /^[A-Za-z]:/.test(fileName)
  ) {
    return true;
  }
  const segments = fileName.split("/");
  return segments.some(
    (segment, index) =>
      segment === "." ||
      segment === ".." ||
      (segment === "" && index !== segments.length - 1),
  );
}

function isSymlink(entry: yauzl.Entry): boolean {
  const hostSystem = entry.versionMadeBy >>> 8;
  if (hostSystem !== 3) return false;
  const unixMode = entry.externalFileAttributes >>> 16;
  return (unixMode & 0xf000) === 0xa000;
}

function hasUnsafeCompression(entry: yauzl.Entry): boolean {
  if (entry.uncompressedSize > MAX_OFFICE_ENTRY_BYTES) return true;
  if (entry.uncompressedSize === 0) return false;
  if (entry.compressedSize === 0) return true;
  return entry.uncompressedSize / entry.compressedSize > MAX_OFFICE_COMPRESSION_RATIO;
}

async function readBoundedEntry(
  zipFile: yauzl.ZipFile,
  entry: yauzl.Entry,
  maxBytes: number,
): Promise<Buffer> {
  if (entry.uncompressedSize > maxBytes) throw invalidOfficeContainer();
  const stream = await zipFile.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > maxBytes) {
      stream.destroy();
      throw invalidOfficeContainer();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function decodeXml(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    if ((bytes.length - 2) % 2 !== 0) throw invalidOfficeContainer();
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    if ((bytes.length - 2) % 2 !== 0) throw invalidOfficeContainer();
    const swapped = Buffer.allocUnsafe(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes,
  );
}

function xmlAttribute(tag: string, attribute: string): string | null {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(
    new RegExp(`${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  return match?.[1] ?? match?.[2] ?? null;
}

function hasExpectedOfficeContentType(
  xml: string,
  requirement: (typeof OFFICE_REQUIREMENTS)[keyof typeof OFFICE_REQUIREMENTS],
): boolean {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return false;
  if (/macroEnabled|vbaProject/i.test(xml)) return false;
  const overrides = xml.match(/<(?:[A-Za-z_][\w.-]*:)?Override\b[^>]*>/g) ?? [];
  return overrides.some(
    (tag) =>
      xmlAttribute(tag, "PartName") === requirement.partName &&
      xmlAttribute(tag, "ContentType") === requirement.contentType,
  );
}

async function validateOfficeContainer(
  bytes: Uint8Array,
  extension: "docx" | "xlsx" | "pptx",
): Promise<void> {
  if (!isZipSignature(bytes)) {
    throw new FileOperationError(415, "FILE_SIGNATURE_MISMATCH", "文件签名与扩展名不一致");
  }
  let zipFile: yauzl.ZipFile | undefined;
  try {
    zipFile = await yauzl.fromBufferPromise(Buffer.from(bytes), {
      autoClose: false,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zipFile.entryCount < 2 || zipFile.entryCount > MAX_OFFICE_ENTRIES) {
      throw invalidOfficeContainer();
    }

    const requirement = OFFICE_REQUIREMENTS[extension];
    const names = new Set<string>();
    let centralDirectoryBytes = 0;
    let totalUncompressed = 0;
    let contentTypesXml: string | null = null;
    let coreEntryFound = false;

    for await (const entry of zipFile.eachEntry()) {
      centralDirectoryBytes +=
        46 + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
      totalUncompressed += entry.uncompressedSize;
      const lowerName = entry.fileName.toLowerCase();
      if (
        centralDirectoryBytes > MAX_OFFICE_CENTRAL_DIRECTORY_BYTES ||
        totalUncompressed > MAX_OFFICE_TOTAL_UNCOMPRESSED_BYTES ||
        entry.isEncrypted() ||
        !entry.canDecodeFileData() ||
        isUnsafeZipPath(entry.fileName) ||
        isSymlink(entry) ||
        hasUnsafeCompression(entry) ||
        names.has(entry.fileName) ||
        lowerName.endsWith("vbaproject.bin") ||
        lowerName.includes("/activex/")
      ) {
        throw invalidOfficeContainer();
      }
      names.add(entry.fileName);

      if (entry.fileName === requirement.coreEntry) coreEntryFound = true;
      if (entry.fileName === "[Content_Types].xml") {
        if (contentTypesXml !== null) throw invalidOfficeContainer();
        contentTypesXml = decodeXml(
          await readBoundedEntry(zipFile, entry, MAX_CONTENT_TYPES_BYTES),
        );
      }
    }

    if (
      !coreEntryFound ||
      contentTypesXml === null ||
      !hasExpectedOfficeContentType(contentTypesXml, requirement)
    ) {
      throw invalidOfficeContainer();
    }
  } catch (error) {
    if (error instanceof FileOperationError) throw error;
    throw invalidOfficeContainer();
  } finally {
    if (zipFile?.isOpen) zipFile.close();
  }
}

function validateText(bytes: Uint8Array): void {
  if (bytes.includes(0)) {
    throw new FileOperationError(415, "FILE_SIGNATURE_MISMATCH", "文件内容不是有效文本");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FileOperationError(415, "FILE_SIGNATURE_MISMATCH", "文件内容不是有效 UTF-8 文本");
  }
}

export async function validateUploadFile(file: File): Promise<ValidatedUpload> {
  const originalFilename = sanitizeOriginalFilename(file.name);
  const extension = extensionOf(originalFilename);
  if (!extension) {
    throw new FileOperationError(415, "UNSUPPORTED_FILE_TYPE", "仅支持 PDF、DOCX、XLSX、PPTX、TXT 和 Markdown");
  }
  if (file.size < 1 || file.size > maxUploadBytes()) {
    throw new FileOperationError(413, "FILE_TOO_LARGE", "文件为空或超过上传大小限制");
  }
  const declaredMimeType = file.type.trim().toLowerCase();
  if (!MIME_TYPES[extension].includes(declaredMimeType)) {
    throw new FileOperationError(415, "FILE_SIGNATURE_MISMATCH", "声明的文件类型与扩展名不一致");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > maxUploadBytes()) {
    throw new FileOperationError(413, "FILE_TOO_LARGE", "文件大小校验失败");
  }
  if (extension === "pdf") {
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      throw new FileOperationError(415, "FILE_SIGNATURE_MISMATCH", "文件签名与扩展名不一致");
    }
  } else if (["docx", "xlsx", "pptx"].includes(extension)) {
    await validateOfficeContainer(bytes, extension as "docx" | "xlsx" | "pptx");
  } else {
    validateText(bytes);
  }
  const displayName = truncateUtf8(
    originalFilename.replace(/\.[^.]+$/, "").trim(),
    MAX_DISPLAY_NAME_BYTES,
  );
  return {
    bytes,
    originalFilename,
    displayName: displayName || "未命名资料",
    extension,
    declaredMimeType,
    detectedMimeType: DETECTED_MIME[extension],
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function generateObjectKey(
  projectId: string,
  documentId: string,
  versionId: string,
): string {
  const safeId = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_OBJECT_KEY_SEGMENT_LENGTH}}$`);
  if (![projectId, documentId, versionId].every((value) => safeId.test(value))) {
    throw new FileOperationError(400, "INVALID_REQUEST", "资源标识无效");
  }
  return `projects/${projectId}/documents/${documentId}/versions/${versionId}/${crypto.randomUUID()}`;
}
