import { withBasePath } from "@/lib/base-path";

export type DocumentLocator = {
  pageNumber?: number;
  slideNumber?: number;
  sheetName?: string;
  cellRange?: string;
  lineStart?: number;
  lineEnd?: number;
  heading?: string;
};

export function documentViewerPath(input: {
  projectId: string;
  documentId: string;
  versionId: string;
  locator?: DocumentLocator;
}): string {
  // Keep this route relative to the Next.js application.  `next/link` adds the
  // configured basePath itself; returning a public path here would otherwise
  // produce `/tool/projectai/tool/projectai/...` behind the Staging proxy.
  const path =
    `/data-spaces/projects/${encodeURIComponent(input.projectId)}` +
    `/documents/${encodeURIComponent(input.documentId)}` +
    `/versions/${encodeURIComponent(input.versionId)}/view`;
  const query = new URLSearchParams();
  const locator = input.locator;
  if (locator?.pageNumber) query.set("page", String(locator.pageNumber));
  if (locator?.slideNumber) query.set("slide", String(locator.slideNumber));
  if (locator?.sheetName) query.set("sheet", locator.sheetName);
  if (locator?.cellRange) query.set("range", locator.cellRange);
  if (locator?.lineStart) query.set("line", String(locator.lineStart));
  if (locator?.lineEnd) query.set("lineEnd", String(locator.lineEnd));
  if (locator?.heading) query.set("heading", locator.heading);
  return query.size ? `${path}?${query.toString()}` : path;
}

/** Use for clipboard values and imperative browser navigation, not `next/link`. */
export function publicDocumentViewerPath(input: Parameters<typeof documentViewerPath>[0]): string {
  return withBasePath(documentViewerPath(input));
}
