import type { DocumentProcessingConfig } from "../config";
import { DocumentProcessingError } from "../errors";
import {
  childElements,
  descendantElements,
  nodeAttribute,
  nodeChildren,
  nodeText,
  parseOrderedXml,
  readOoxmlParts,
  type OrderedXmlNode,
} from "../ooxml";
import { validateSourceLocator } from "../source-locator";
import type { ParsedDocument, ParsedSection } from "../types";

function firstDescendant(
  nodes: OrderedXmlNode[],
  localName: string,
): OrderedXmlNode | undefined {
  return descendantElements(nodes, localName)[0];
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function headingLevel(paragraph: OrderedXmlNode): number | null {
  const children = nodeChildren(paragraph);
  const style = firstDescendant(children, "pStyle");
  const styleName = style ? nodeAttribute(style, "val") : null;
  const match = styleName?.match(/(?:heading|标题)\s*([1-9])/i);
  if (match) return Number(match[1]);
  const outline = firstDescendant(children, "outlineLvl");
  const outlineValue = outline ? Number(nodeAttribute(outline, "val")) : NaN;
  return Number.isInteger(outlineValue) && outlineValue >= 0 && outlineValue <= 8
    ? outlineValue + 1
    : null;
}

export async function parseDocxDocument(
  bytes: Uint8Array,
  config: DocumentProcessingConfig,
): Promise<ParsedDocument> {
  const parts = await readOoxmlParts(
    bytes,
    (name) => name === "word/document.xml",
  );
  const documentXml = parts.get("word/document.xml");
  if (!documentXml) {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "DOCX main document part is missing.",
    );
  }
  const documentNodes = parseOrderedXml(documentXml);
  const body = descendantElements(documentNodes, "body")[0];
  if (!body) {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "DOCX body is missing.",
    );
  }

  const sections: ParsedSection[] = [];
  const headingPath: string[] = [];
  let paragraphNumber = 0;
  let totalCharacters = 0;
  const append = (
    content: string,
    sectionType: ParsedSection["sectionType"],
    start: number,
    end: number,
    heading?: string,
  ) => {
    const normalized = content.trim();
    if (!normalized) return;
    totalCharacters += normalized.length;
    if (totalCharacters > config.maxCharacters) {
      throw new DocumentProcessingError(
        "DOCUMENT_TOO_MUCH_TEXT",
        "DOCX text exceeds the processing limit.",
      );
    }
    if (sections.length >= config.maxSections) {
      throw new DocumentProcessingError(
        "DOCUMENT_TOO_COMPLEX",
        "DOCX section count exceeds the processing limit.",
      );
    }
    sections.push({
      sectionType,
      heading: heading ?? null,
      headingPath: [...headingPath],
      paragraphStart: start,
      paragraphEnd: end,
      sourceLocator: validateSourceLocator({
        type: "docx_section",
        headingPath: [...headingPath],
        paragraphStart: start,
        paragraphEnd: end,
      }),
      content: normalized,
    });
  };

  for (const element of nodeChildren(body)) {
    const name = Object.keys(element)
      .find((key) => key !== ":@" && key !== "#text")
      ?.split(":")
      .at(-1);
    if (name === "p") {
      const content = cleanText(nodeText(nodeChildren(element)));
      if (!content) continue;
      paragraphNumber += 1;
      const level = headingLevel(element);
      if (level) {
        headingPath.splice(level - 1);
        headingPath[level - 1] = content;
        append(content, "heading", paragraphNumber, paragraphNumber, content);
      } else {
        const list =
          descendantElements(nodeChildren(element), "numPr").length > 0;
        append(
          content,
          list ? "list" : "paragraph_group",
          paragraphNumber,
          paragraphNumber,
        );
      }
    } else if (name === "tbl") {
      const rows: string[] = [];
      for (const row of descendantElements(nodeChildren(element), "tr")) {
        const cells = childElements(nodeChildren(row), "tc")
          .map((cell) => cleanText(nodeText(nodeChildren(cell))))
          .filter(Boolean);
        if (cells.length) rows.push(cells.join(" | "));
      }
      if (rows.length) {
        const start = paragraphNumber + 1;
        paragraphNumber += rows.length;
        append(rows.join("\n"), "table", start, paragraphNumber);
      }
    }
  }
  return { sections, totalCharacters };
}
