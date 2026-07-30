import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";

const FONT = { ascii: "Hiragino Sans GB", hAnsi: "Hiragino Sans GB", eastAsia: "Hiragino Sans GB", hint: "eastAsia" };
const LANGUAGE = { value: "zh-CN", eastAsia: "zh-CN" };

function safeFilename(value: string): string {
  return (value.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim() || "ProjectAI-需求文档").slice(0, 120);
}

function paragraph(line: string): Paragraph {
  if (line.startsWith("## ")) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 } });
  if (line.startsWith("# ")) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } });
  if (line.startsWith("- ")) return new Paragraph({ text: line.slice(2), bullet: { level: 0 }, spacing: { after: 60 } });
  if (line.startsWith("> ")) return new Paragraph({ children: [new TextRun({ text: line.slice(2), italics: true, color: "6B7280" })], spacing: { after: 100 } });
  return new Paragraph({ children: [new TextRun({ text: line, font: FONT, language: LANGUAGE, size: 22 })], spacing: { after: line.trim() ? 100 : 40, line: 276 } });
}

export async function requirementDocx(markdown: string): Promise<Uint8Array> {
  const document = new Document({
    styles: {
      default: { document: { run: { font: FONT, language: LANGUAGE, size: 22 }, paragraph: { spacing: { after: 100, line: 276 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: "1F4E78", font: FONT, language: LANGUAGE }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, color: "1F4E78", font: FONT, language: LANGUAGE }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "ProjectAI · 项目需求文档", color: "6B7280", size: 18, font: FONT, language: LANGUAGE })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ProjectAI  ·  ", color: "6B7280", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: "6B7280", size: 18 })] })] }) },
      children: markdown.split(/\r?\n/).map(paragraph),
    }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

export function requirementExportFilename(projectName: string, version: number, extension: "md" | "docx"): string {
  return `${safeFilename(`${projectName}-需求文档-v${version}`)}.${extension}`;
}
