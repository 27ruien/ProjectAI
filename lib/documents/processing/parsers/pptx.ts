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
} from "../ooxml";
import { validateSourceLocator } from "../source-locator";
import type { ParsedDocument, ParsedSection } from "../types";

function relationTargets(xml: Buffer): Map<string, string> {
  const targets = new Map<string, string>();
  for (const relation of descendantElements(parseOrderedXml(xml), "Relationship")) {
    if (nodeAttribute(relation, "TargetMode")?.toLowerCase() === "external") {
      continue;
    }
    const id = nodeAttribute(relation, "Id");
    const target = nodeAttribute(relation, "Target");
    if (id && target) targets.set(id, target);
  }
  return targets;
}

export async function parsePptxDocument(
  bytes: Uint8Array,
  config: DocumentProcessingConfig,
): Promise<ParsedDocument> {
  const parts = await readOoxmlParts(
    bytes,
    (name) =>
      name === "ppt/presentation.xml" ||
      name === "ppt/_rels/presentation.xml.rels" ||
      /^ppt\/slides\/slide\d+\.xml$/i.test(name),
  );
  const presentationXml = parts.get("ppt/presentation.xml");
  const relationsXml = parts.get("ppt/_rels/presentation.xml.rels");
  if (!presentationXml || !relationsXml) {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "PPTX presentation metadata is missing.",
    );
  }
  const relations = relationTargets(relationsXml);
  const slideIds = descendantElements(parseOrderedXml(presentationXml), "sldId");
  if (slideIds.length > config.maxSlides) {
    throw new DocumentProcessingError(
      "DOCUMENT_TOO_MANY_SLIDES",
      "PPTX slide count exceeds the processing limit.",
    );
  }
  const sections: ParsedSection[] = [];
  let totalCharacters = 0;
  for (let index = 0; index < slideIds.length; index += 1) {
    const relationId =
      nodeQualifiedAttribute(slideIds[index]!, "r:id") ??
      nodeAttribute(slideIds[index]!, "id");
    const target = relationId ? relations.get(relationId) : null;
    const partName = target ? normalizePartTarget("ppt", target) : null;
    const slideXml = partName ? parts.get(partName) : null;
    if (!slideXml) {
      throw new DocumentProcessingError(
        "INVALID_DOCUMENT_STRUCTURE",
        "PPTX slide part is missing.",
      );
    }
    const slideNodes = parseOrderedXml(slideXml);
    const paragraphs = descendantElements(slideNodes, "p")
      .map((paragraph) => nodeText(nodeChildren(paragraph)).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const content = paragraphs.join("\n").trim();
    if (!content) continue;
    totalCharacters += content.length;
    if (totalCharacters > config.maxCharacters) {
      throw new DocumentProcessingError(
        "DOCUMENT_TOO_MUCH_TEXT",
        "PPTX text exceeds the processing limit.",
      );
    }
    const slideNumber = index + 1;
    sections.push({
      sectionType: "slide",
      heading: paragraphs[0]?.slice(0, 500) ?? null,
      headingPath: paragraphs[0] ? [paragraphs[0].slice(0, 500)] : [],
      slideNumber,
      sourceLocator: validateSourceLocator({
        type: "pptx_slide",
        slideNumber,
      }),
      content,
    });
  }
  return { sections, totalCharacters };
}
