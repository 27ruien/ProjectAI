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

function pdfWithContent(content: string | null): Uint8Array {
  const escaped = (content ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  const stream = content
    ? `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`
    : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export function createSearchablePdfFixture(
  filename = "Project Aurora Scope.pdf",
  content = "Project Aurora Launch date: October 15 Budget USD 100,000",
): File {
  return new File([blobPart(pdfWithContent(content))], filename, {
    type: "application/pdf",
  });
}

export function createScannedPdfFixture(
  filename = "Project Aurora Scan.pdf",
): File {
  return new File([blobPart(pdfWithContent(null))], filename, {
    type: "application/pdf",
  });
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

export function createSearchableDocxFixture(
  filename = "Project Aurora Notes.docx",
): File {
  const definition = officeDefinition.docx;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Override PartName="${definition.partName}" ContentType="${definition.contentType}"/>` +
    `</Types>`;
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Timeline</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Project Aurora launch date is October 15.</w:t></w:r></w:p>` +
    `<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Owner: Example Manager</w:t></w:r></w:p>` +
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Budget</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>USD 100,000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
    `</w:body></w:document>`;
  const archive = zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: definition.core, data: documentXml },
  ]);
  return new File([blobPart(archive)], filename, { type: definition.mime });
}

export function createSearchableXlsxFixture(
  filename = "Project Aurora Budget.xlsx",
): File {
  const definition = officeDefinition.xlsx;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Override PartName="${definition.partName}" ContentType="${definition.contentType}"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `</Types>`;
  const workbook =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
    `</Relationships>`;
  const sheet =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="inlineStr"><is><t>Budget</t></is></c><c r="B1" t="inlineStr"><is><t>USD 100,000</t></is></c></row>` +
    `<row r="2"><c r="A2" t="inlineStr"><is><t>Launch date</t></is></c><c r="B2" t="inlineStr"><is><t>October 15</t></is></c></row>` +
    `</sheetData></worksheet>`;
  const archive = zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: definition.core, data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: rels },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
  return new File([blobPart(archive)], filename, { type: definition.mime });
}

export function createSearchablePptxFixture(
  filename = "Project Aurora Milestones.pptx",
): File {
  const definition = officeDefinition.pptx;
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Override PartName="${definition.partName}" ContentType="${definition.contentType}"/>` +
    `<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
    `</Types>`;
  const presentation =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>` +
    `</Relationships>`;
  const slide =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<p:cSld><p:spTree><p:sp><p:txBody>` +
    `<a:p><a:r><a:t>Milestone</a:t></a:r></a:p>` +
    `<a:p><a:r><a:t>Project Aurora launch October 15</a:t></a:r></a:p>` +
    `</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const archive = zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: definition.core, data: presentation },
    { name: "ppt/_rels/presentation.xml.rels", data: rels },
    { name: "ppt/slides/slide1.xml", data: slide },
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
