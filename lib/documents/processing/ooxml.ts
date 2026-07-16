import yauzl from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { DocumentProcessingError } from "./errors";

const MAX_ENTRIES = 2_000;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 1_000;

export type OrderedXmlNode = Record<string, unknown>;

function unsafePath(name: string): boolean {
  return (
    !name ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((segment) => segment === "." || segment === "..")
  );
}

function symlink(entry: yauzl.Entry): boolean {
  const hostSystem = entry.versionMadeBy >>> 8;
  const unixMode = entry.externalFileAttributes >>> 16;
  return hostSystem === 3 && (unixMode & 0xf000) === 0xa000;
}

async function readEntry(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Buffer> {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new DocumentProcessingError(
      "DOCUMENT_TOO_COMPLEX",
      "OOXML part exceeds the processing limit.",
    );
  }
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_ENTRY_BYTES) {
      stream.destroy();
      throw new DocumentProcessingError(
        "DOCUMENT_TOO_COMPLEX",
        "OOXML part exceeds the processing limit.",
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

export async function readOoxmlParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Promise<Map<string, Buffer>> {
  let zip: yauzl.ZipFile | undefined;
  try {
    zip = await yauzl.fromBufferPromise(Buffer.from(bytes), {
      autoClose: false,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    if (zip.entryCount < 2 || zip.entryCount > MAX_ENTRIES) {
      throw new DocumentProcessingError(
        "DOCUMENT_TOO_COMPLEX",
        "OOXML entry count exceeds the processing limit.",
      );
    }
    const parts = new Map<string, Buffer>();
    const names = new Set<string>();
    let totalBytes = 0;
    for await (const entry of zip.eachEntry()) {
      totalBytes += entry.uncompressedSize;
      const ratio =
        entry.uncompressedSize === 0
          ? 0
          : entry.compressedSize === 0
            ? Number.POSITIVE_INFINITY
            : entry.uncompressedSize / entry.compressedSize;
      const lower = entry.fileName.toLowerCase();
      if (
        totalBytes > MAX_TOTAL_BYTES ||
        unsafePath(entry.fileName) ||
        names.has(entry.fileName) ||
        entry.isEncrypted() ||
        !entry.canDecodeFileData() ||
        symlink(entry) ||
        ratio > MAX_COMPRESSION_RATIO ||
        lower.endsWith("vbaproject.bin") ||
        lower.includes("/activex/") ||
        lower.includes("/embeddings/")
      ) {
        throw new DocumentProcessingError(
          "INVALID_DOCUMENT_STRUCTURE",
          "Unsafe OOXML structure.",
        );
      }
      names.add(entry.fileName);
      if (!entry.fileName.endsWith("/") && wanted(entry.fileName)) {
        parts.set(entry.fileName, await readEntry(zip, entry));
      }
    }
    return parts;
  } catch (error) {
    if (error instanceof DocumentProcessingError) throw error;
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "Invalid OOXML container.",
    );
  } finally {
    if (zip?.isOpen) zip.close();
  }
}

function decodeXmlBytes(bytes: Buffer): string {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const swapped = Buffer.allocUnsafe(bytes.length - 2);
      for (let index = 2; index + 1 < bytes.length; index += 2) {
        swapped[index - 2] = bytes[index + 1]!;
        swapped[index - 1] = bytes[index]!;
      }
      return new TextDecoder("utf-16le", { fatal: true }).decode(swapped);
    }
    const offset =
      bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset));
  } catch {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "OOXML XML encoding is invalid.",
    );
  }
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

export function parseOrderedXml(bytes: Buffer): OrderedXmlNode[] {
  const xml = decodeXmlBytes(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "OOXML XML is invalid or contains a prohibited declaration.",
    );
  }
  const parsed = parser.parse(xml);
  if (!Array.isArray(parsed)) {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "OOXML XML root is invalid.",
    );
  }
  return parsed as OrderedXmlNode[];
}

export function elementName(node: OrderedXmlNode): string | null {
  return (
    Object.keys(node).find((key) => key !== ":@" && key !== "#text") ?? null
  );
}

export function nodeChildren(node: OrderedXmlNode): OrderedXmlNode[] {
  const name = elementName(node);
  const value = name ? node[name] : null;
  return Array.isArray(value) ? (value as OrderedXmlNode[]) : [];
}

export function childElements(
  nodes: OrderedXmlNode[],
  localName: string,
): OrderedXmlNode[] {
  return nodes.filter((node) => elementName(node)?.split(":").at(-1) === localName);
}

export function descendantElements(
  nodes: OrderedXmlNode[],
  localName: string,
): OrderedXmlNode[] {
  const found: OrderedXmlNode[] = [];
  const visit = (items: OrderedXmlNode[]) => {
    for (const node of items) {
      if (elementName(node)?.split(":").at(-1) === localName) found.push(node);
      visit(nodeChildren(node));
    }
  };
  visit(nodes);
  return found;
}

export function nodeAttribute(
  node: OrderedXmlNode,
  localName: string,
): string | null {
  const attributes = node[":@"];
  if (!attributes || typeof attributes !== "object") return null;
  for (const [key, value] of Object.entries(attributes)) {
    if (key.replace(/^@_/, "").split(":").at(-1) === localName) {
      return typeof value === "string" ? decodeXmlEntities(value) : String(value);
    }
  }
  return null;
}

export function nodeQualifiedAttribute(
  node: OrderedXmlNode,
  qualifiedName: string,
): string | null {
  const attributes = node[":@"];
  if (!attributes || typeof attributes !== "object") return null;
  const value = (attributes as Record<string, unknown>)[`@_${qualifiedName}`];
  return typeof value === "string" ? decodeXmlEntities(value) : null;
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      const normalized = entity.toLowerCase();
      if (named[normalized]) return named[normalized];
      const number = normalized.startsWith("&#x")
        ? Number.parseInt(normalized.slice(3, -1), 16)
        : Number.parseInt(normalized.slice(2, -1), 10);
      return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : "";
    },
  );
}

export function nodeText(nodes: OrderedXmlNode[]): string {
  let output = "";
  const visit = (items: OrderedXmlNode[]) => {
    for (const node of items) {
      const text = node["#text"];
      if (typeof text === "string") output += decodeXmlEntities(text);
      visit(nodeChildren(node));
    }
  };
  visit(nodes);
  return output;
}

export function normalizePartTarget(baseDirectory: string, target: string): string | null {
  const normalizedTarget = target.replace(/\\/g, "/");
  if (
    !normalizedTarget ||
    normalizedTarget.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalizedTarget)
  ) {
    return null;
  }
  const parts = `${baseDirectory}/${normalizedTarget}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!resolved.length) return null;
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}
