import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { strToU8, zipSync } from "fflate";
import type { WorkflowArtifactPayload } from "./service";
import { WorkflowError } from "./errors";

function xml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeFilename(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
  return (normalized || "ProjectAI-Artifact").slice(0, 120);
}

export function markdownBytes(artifact: WorkflowArtifactPayload): Uint8Array {
  return new TextEncoder().encode(artifact.markdown);
}

function paragraphForLine(line: string): Paragraph {
  if (line.startsWith("### ")) return new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } });
  if (line.startsWith("## ")) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 } });
  if (line.startsWith("# ")) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } });
  if (line.startsWith("- ")) return new Paragraph({ text: line.slice(2), bullet: { level: 0 }, spacing: { after: 60 } });
  if (!line.trim()) return new Paragraph({ text: "", spacing: { after: 40 } });
  return new Paragraph({ children: [new TextRun({ text: line, font: "Calibri", size: 22 })], spacing: { after: 100, line: 276 } });
}

export async function docxBytes(input: { artifact: WorkflowArtifactPayload; projectName: string; generatedAt: Date }): Promise<Uint8Array> {
  const { artifact } = input;
  const masthead = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [new TableCell({ shading: { type: ShadingType.SOLID, fill: "1F4E78" }, children: [new Paragraph({ children: [new TextRun({ text: artifact.title, color: "FFFFFF", bold: true, size: 32, font: "Calibri" })], spacing: { before: 120, after: 80 } })] })] }),
      new TableRow({ children: [new TableCell({ shading: { type: ShadingType.SOLID, fill: "D9EAF7" }, children: [new Paragraph({ children: [new TextRun({ text: `项目：${input.projectName}  ·  版本：v${artifact.currentVersion}  ·  生成：${input.generatedAt.toISOString()}`, color: "333333", size: 18, font: "Calibri" })], spacing: { before: 60, after: 60 } })] })] }),
    ],
  });
  const body = artifact.markdown.split(/\r?\n/).slice(1).map(paragraphForLine);
  const document = new Document({
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { after: 100, line: 276 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: "1F4E78", font: "Calibri" }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, color: "1F4E78", font: "Calibri" }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: "365F91", font: "Calibri" }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
      ],
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } },
      },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "ProjectAI · Workflow Artifact", color: "6B7280", size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ProjectAI  ·  ", color: "6B7280", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: "6B7280", size: 18 })] })] }) },
      children: [masthead, new Paragraph({ text: "" }), ...body],
    }],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

type Sheet = { name: string; rows: unknown[][]; widths: number[] };

function cell(value: unknown, style: number): string {
  if (typeof value === "number" && Number.isFinite(value)) return `<c s="${style}" t="n"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c s="${style}" t="inlineStr"><is><t>${value ? "是" : "否"}</t></is></c>`;
  return `<c s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="26" customHeight="1"' : ""}>${row.map((value) => cell(value, rowIndex === 0 ? 1 : 2)).join("")}</row>`).join("");
  const columns = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${Math.max(8, Math.min(width, 60))}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${columnName(sheet.rows[0]?.length ?? 1)}${Math.max(sheet.rows.length, 1)}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function columnName(index: number): string {
  let value = Math.max(index, 1);
  let result = "";
  while (value) { value -= 1; result = String.fromCharCode(65 + (value % 26)) + result; value = Math.floor(value / 26); }
  return result;
}

function workbookBytes(sheets: Sheet[]): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name.slice(0, 31))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
    "xl/styles.xml": strToU8(styles),
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet)); });
  return zipSync(files, { level: 6 });
}

export function xlsxBytes(artifact: WorkflowArtifactPayload): Uint8Array {
  if (artifact.kind === "ga4_measurement_plan") {
    const content = artifact.content as {
      overview: Record<string, unknown>;
      publicParameters: Array<Record<string, unknown>>;
      events: Array<Record<string, unknown>>;
      requirementEventCoverage: Array<Record<string, unknown>>;
      pageEventMatrix: Array<Record<string, unknown>>;
    };
    return workbookBytes([
      { name: "概览", widths: [24, 48], rows: [["字段", "内容"], ["统计平台", content.overview.platform], ["统计平台 ID", content.overview.measurementId], ["埋点验证状态", content.overview.validationStatus], ["埋点项目名称", content.overview.projectName], ["埋点项目链接", content.overview.projectLink]] },
      { name: "公共参数", widths: [20, 32, 24, 40, 18, 32], rows: [["参数名称", "参数描述", "参数 Key", "参数 Value 取值规则", "参数 Value 类型", "备注"], ...content.publicParameters.map((item) => [item.name, item.description, item.key, item.valueRule, item.valueType, item.note])] },
      { name: "自定义参数", widths: [24, 12, 18, 36, 24, 20, 30, 24, 40, 18, 30, 30], rows: [["事件名称", "核心事件", "事件类型", "事件描述", "事件 ID", "参数名称", "参数描述", "参数 Key", "参数值取值规则", "参数值类型", "备注", "开发反馈"], ...content.events.map((item) => [item.eventName, item.coreEvent, item.eventType, item.description, item.eventId, item.parameterName, item.parameterDescription, item.parameterKey, item.parameterValueRule, item.parameterValueType, item.note, item.developerFeedback])] },
      { name: "Requirement-Event Matrix", widths: [42, 28, 16], rows: [["Requirement", "Event ID", "验收状态"], ...content.requirementEventCoverage.map((item) => [item.requirement, item.eventId, item.status])] },
      { name: "Page-Event Matrix", widths: [30, 28, 16], rows: [["页面", "Event ID", "验收状态"], ...content.pageEventMatrix.map((item) => [item.page, item.eventId, item.status])] },
    ]);
  }
  if (artifact.kind === "action_plan") {
    const tasks = (artifact.content.tasks ?? []) as Array<Record<string, unknown>>;
    return workbookBytes([{ name: "Action Plan", widths: [38, 38, 18, 18, 14, 14, 12, 12, 28, 32, 32, 20, 18, 38, 14, 24, 28, 18], rows: [["Task CN", "Task", "Owner", "相关方", "Start Date", "End Date", "Progress", "Milestone", "Meetings", "Parent Record", "Dependency", "Confirmation Owner", "Latest Confirmation Date", "Delay Impact", "Critical Path", "Source Citation", "Assumption", "Status"], ...tasks.map((task) => [task.taskCn, task.taskEn, task.owner, task.stakeholder, task.startDate, task.endDate, task.progress, task.milestone, task.meeting, task.parentTask ?? "", Array.isArray(task.dependency) ? task.dependency.join("; ") : "", task.confirmationOwner, task.latestConfirmationDate, task.delayImpact, task.criticalPath, task.sourceCitation, task.assumption, task.status])] }]);
  }
  throw new WorkflowError(422, "WORKFLOW_EXPORT_FORMAT_UNSUPPORTED", "该产物不支持 XLSX 导出");
}

export async function buildArtifactExport(input: { artifact: WorkflowArtifactPayload; projectName: string; format: "md" | "docx" | "xlsx" | "txt" }) {
  let bytes: Uint8Array;
  let contentType: string;
  if (input.format === "md" || input.format === "txt") {
    bytes = markdownBytes(input.artifact);
    contentType = "text/markdown; charset=utf-8";
  } else if (input.format === "docx") {
    bytes = await docxBytes({ artifact: input.artifact, projectName: input.projectName, generatedAt: new Date() });
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else {
    bytes = xlsxBytes(input.artifact);
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return { bytes, contentType, filename: `${safeFilename(`${input.projectName}-${input.artifact.title}`)}.${input.format}` };
}
