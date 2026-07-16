import { createHash } from "node:crypto";

export type InMemoryFileFixture = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

function escapedPdfText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

/** Creates a small, structurally valid PDF entirely in memory. */
export function fictitiousPdf(name: string, version: number): InMemoryFileFixture {
  const label = escapedPdfText(`FICTITIOUS PROJECT DOCUMENT - VERSION ${version}`);
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${label}) Tj\n0 -28 Td\n/F1 10 Tf\n(TEST DATA ONLY - NO CUSTOMER CONTENT) Tj\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`,
  ];
  let source = "%PDF-1.4\n% FICTITIOUS TEST FILE\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source, "latin1"));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source, "latin1");
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return { name, mimeType: "application/pdf", buffer: Buffer.from(source, "latin1") };
}

export function fictitiousText(name: string, marker: string): InMemoryFileFixture {
  return {
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(
      `FICTITIOUS TEST FILE\n${marker}\nNO CUSTOMER CONTENT\n`,
      "utf8",
    ),
  };
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries: Array<{ name: string; contents: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const contents = Buffer.from(entry.contents, "utf8");
    const checksum = crc32(contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(contents.length, 18);
    local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, contents);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(contents.length, 20);
    central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + contents.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

/** Creates the minimum safe OOXML container expected by server validation. */
export function fictitiousOoxml(
  kind: "docx" | "xlsx" | "pptx",
  name: string,
): InMemoryFileFixture {
  const application = { docx: "word", xlsx: "xl", pptx: "ppt" }[kind];
  const mimeType = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }[kind];
  const mainPart = {
    docx: "word/document.xml",
    xlsx: "xl/workbook.xml",
    pptx: "ppt/presentation.xml",
  }[kind];
  const mainContentType = {
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  }[kind];
  return {
    name,
    mimeType,
    buffer: storedZip([
      {
        name: "[Content_Types].xml",
        contents: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${mainPart}" ContentType="${mainContentType}"/></Types>`,
      },
      {
        name: `${application}/`,
        contents: "",
      },
      {
        name: mainPart,
        contents: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><fictitious>TEST DATA ONLY</fictitious>",
      },
    ]),
  };
}

export function fixtureSha256(fixture: InMemoryFileFixture): string {
  return createHash("sha256").update(fixture.buffer).digest("hex");
}
