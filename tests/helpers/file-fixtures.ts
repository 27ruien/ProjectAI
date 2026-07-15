import { createHash } from "node:crypto";

type ZipEntry = {
  name: string;
  data: Uint8Array | string;
};

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: ZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content =
      typeof entry.data === "string"
        ? Buffer.from(entry.data, "utf8")
        : Buffer.from(entry.data);
    const checksum = crc32(content);
    const flags = 0x800;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(content.byteLength, 18);
    localHeader.writeUInt32LE(content.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(content.byteLength, 20);
    centralHeader.writeUInt32LE(content.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.byteLength + name.byteLength + content.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function createPdfFixture(
  filename = "虚构项目说明.pdf",
  marker = "fictional-pdf-v1",
): File {
  const body = `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${marker}\n%%EOF\n`;
  return new File([body], filename, { type: "application/pdf" });
}

export function createTextFixture(
  filename = "虚构项目记录.txt",
  marker = "仅用于 Project AI OS 自动化测试的虚构内容。",
): File {
  return new File([`${marker}\n`], filename, { type: "text/plain" });
}

export function createMarkdownFixture(
  filename = "虚构会议纪要.md",
  marker = "版本一",
): File {
  return new File(
    [`# 虚构会议纪要\n\n- 标记：${marker}\n- 不包含客户资料\n`],
    filename,
    { type: "text/markdown" },
  );
}

const officeDefinition = {
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    core: "word/document.xml",
    partName: "/word/document.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    core: "xl/workbook.xml",
    partName: "/xl/workbook.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    core: "ppt/presentation.xml",
    partName: "/ppt/presentation.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
} as const;

export type OfficeFixtureExtension = keyof typeof officeDefinition;

export function createOfficeFixture(
  extension: OfficeFixtureExtension,
  filename = `虚构项目资料.${extension}`,
): File {
  const definition = officeDefinition[extension];
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Override PartName="${definition.partName}" ContentType="${definition.contentType}"/>` +
    `</Types>`;
  const archive = zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: definition.core, data: "<fictional-document/>" },
  ]);
  return new File([blobPart(archive)], filename, { type: definition.mime });
}

export function createInvalidOfficeFixture(
  extension: OfficeFixtureExtension = "docx",
): File {
  const definition = officeDefinition[extension];
  const archive = zip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: definition.core, data: "<fictional-document/>" },
  ]);
  return new File([blobPart(archive)], `伪造容器.${extension}`, {
    type: definition.mime,
  });
}

export function createSignatureMismatchFixture(): File {
  return new File(["这不是 PDF 文件。"], "伪装资料.pdf", {
    type: "application/pdf",
  });
}

export async function fileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export async function fileSha256(file: File): Promise<string> {
  return createHash("sha256").update(await fileBytes(file)).digest("hex");
}
