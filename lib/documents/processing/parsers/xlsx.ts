import type { DocumentProcessingConfig } from "../config";
import { DocumentProcessingError } from "../errors";
import {
  descendantElements,
  nodeAttribute,
  nodeQualifiedAttribute,
  nodeChildren,
  nodeText,
  normalizePartTarget,
  parseOrderedXml,
  readOoxmlParts,
  type OrderedXmlNode,
} from "../ooxml";
import { validateSourceLocator } from "../source-locator";
import type { ParsedDocument, ParsedSection } from "../types";

type Relationship = { target: string; external: boolean };

function relationships(xml: Buffer): Map<string, Relationship> {
  const map = new Map<string, Relationship>();
  for (const relation of descendantElements(parseOrderedXml(xml), "Relationship")) {
    const id = nodeAttribute(relation, "Id");
    const target = nodeAttribute(relation, "Target");
    if (!id || !target) continue;
    map.set(id, {
      target,
      external: nodeAttribute(relation, "TargetMode")?.toLowerCase() === "external",
    });
  }
  return map;
}

function columnNumber(reference: string): number | null {
  const match = reference.match(/^([A-Z]+)\d+$/i);
  if (!match) return null;
  let value = 0;
  for (const character of match[1]!.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value;
}

function columnName(value: number): string {
  let current = value;
  let output = "";
  while (current > 0) {
    current -= 1;
    output = String.fromCharCode(65 + (current % 26)) + output;
    current = Math.floor(current / 26);
  }
  return output;
}

function firstText(node: OrderedXmlNode, localName: string): string | null {
  const target = descendantElements(nodeChildren(node), localName)[0];
  return target ? nodeText(nodeChildren(target)).trim() : null;
}

function cellValue(cell: OrderedXmlNode, sharedStrings: string[]): string {
  const type = nodeAttribute(cell, "t");
  if (type === "inlineStr") {
    const inline = descendantElements(nodeChildren(cell), "is")[0];
    return inline ? nodeText(nodeChildren(inline)).trim() : "";
  }
  const raw = firstText(cell, "v") ?? "";
  if (type === "s") {
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 ? sharedStrings[index] ?? "" : "";
  }
  if (type === "b") return raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw;
  if (type === "str") return raw;
  if (raw) return raw;
  const formula = firstText(cell, "f");
  return formula ? `Formula: ${formula}` : "";
}

export async function parseXlsxDocument(
  bytes: Uint8Array,
  config: DocumentProcessingConfig,
): Promise<ParsedDocument> {
  const parts = await readOoxmlParts(
    bytes,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(name),
  );
  const workbookXml = parts.get("xl/workbook.xml");
  const relationsXml = parts.get("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relationsXml) {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "XLSX workbook metadata is missing.",
    );
  }
  const rels = relationships(relationsXml);
  const sharedStringsXml = parts.get("xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml
    ? descendantElements(parseOrderedXml(sharedStringsXml), "si").map((item) =>
        nodeText(nodeChildren(item)).trim(),
      )
    : [];
  const sheets = descendantElements(parseOrderedXml(workbookXml), "sheet");
  if (sheets.length > config.maxSheets) {
    throw new DocumentProcessingError(
      "DOCUMENT_TOO_MANY_SHEETS",
      "XLSX sheet count exceeds the processing limit.",
    );
  }
  const sections: ParsedSection[] = [];
  let totalCharacters = 0;
  let totalCells = 0;
  for (const sheet of sheets) {
    const state = nodeAttribute(sheet, "state")?.toLowerCase();
    // Hidden and very-hidden sheets are deliberately excluded from the index.
    if (state === "hidden" || state === "veryhidden") continue;
    const sheetName = nodeAttribute(sheet, "name")?.trim();
    const relationId =
      nodeQualifiedAttribute(sheet, "r:id") ?? nodeAttribute(sheet, "id");
    const relation = relationId ? rels.get(relationId) : null;
    if (!sheetName || !relation || relation.external) continue;
    const partName = normalizePartTarget("xl", relation.target);
    const sheetXml = partName ? parts.get(partName) : null;
    if (!sheetXml) {
      throw new DocumentProcessingError(
        "INVALID_DOCUMENT_STRUCTURE",
        "XLSX worksheet part is missing.",
      );
    }
    const rows = descendantElements(parseOrderedXml(sheetXml), "row");
    if (rows.length > config.maxRows) {
      throw new DocumentProcessingError(
        "DOCUMENT_TOO_MANY_ROWS",
        "XLSX row count exceeds the processing limit.",
      );
    }
    for (const row of rows) {
      const rowNumber = Number(nodeAttribute(row, "r"));
      if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
      const cells: Array<{ column: number; value: string }> = [];
      for (const cell of descendantElements(nodeChildren(row), "c")) {
        totalCells += 1;
        if (totalCells > config.maxCells) {
          throw new DocumentProcessingError(
            "DOCUMENT_TOO_MANY_CELLS",
            "XLSX cell count exceeds the processing limit.",
          );
        }
        const column = columnNumber(nodeAttribute(cell, "r") ?? "");
        if (!column || column > config.maxColumns) {
          if (column && column > config.maxColumns) {
            throw new DocumentProcessingError(
              "DOCUMENT_TOO_COMPLEX",
              "XLSX column count exceeds the processing limit.",
            );
          }
          continue;
        }
        const value = cellValue(cell, sharedStrings).slice(0, 32_000).trim();
        if (value) cells.push({ column, value });
      }
      if (!cells.length) continue;
      const columnStart = Math.min(...cells.map((cell) => cell.column));
      const columnEnd = Math.max(...cells.map((cell) => cell.column));
      const content = cells
        .map((cell) => `${columnName(cell.column)}: ${cell.value}`)
        .join(" | ");
      totalCharacters += content.length;
      if (totalCharacters > config.maxCharacters) {
        throw new DocumentProcessingError(
          "DOCUMENT_TOO_MUCH_TEXT",
          "XLSX text exceeds the processing limit.",
        );
      }
      if (sections.length >= config.maxSections) {
        throw new DocumentProcessingError(
          "DOCUMENT_TOO_COMPLEX",
          "XLSX section count exceeds the processing limit.",
        );
      }
      sections.push({
        sectionType: "sheet_range",
        heading: sheetName,
        headingPath: [sheetName],
        sheetName,
        columnStart,
        columnEnd,
        rowStart: rowNumber,
        rowEnd: rowNumber,
        sourceLocator: validateSourceLocator({
          type: "xlsx_range",
          sheetName,
          columnStart,
          columnEnd,
          rowStart: rowNumber,
          rowEnd: rowNumber,
        }),
        content,
      });
    }
  }
  return { sections, totalCharacters };
}
