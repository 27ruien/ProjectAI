import { z } from "zod";

const headingPath = z.array(z.string().trim().min(1).max(500)).max(20);

export const sourceLocatorSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("pdf_page"),
    pageNumber: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("docx_section"),
    headingPath,
    paragraphStart: z.number().int().positive(),
    paragraphEnd: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("xlsx_range"),
    sheetName: z.string().trim().min(1).max(255),
    columnStart: z.number().int().positive(),
    columnEnd: z.number().int().positive(),
    rowStart: z.number().int().positive(),
    rowEnd: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("pptx_slide"),
    slideNumber: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("text_lines"),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("markdown_section"),
    headingPath,
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
  }),
]);

export type SourceLocator = z.infer<typeof sourceLocatorSchema>;

export function validateSourceLocator(value: unknown): SourceLocator {
  return sourceLocatorSchema.parse(value);
}
