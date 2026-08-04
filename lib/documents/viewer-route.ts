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
  const path = withBasePath(
    `/data-spaces/projects/${encodeURIComponent(input.projectId)}` +
      `/documents/${encodeURIComponent(input.documentId)}` +
      `/versions/${encodeURIComponent(input.versionId)}/view`,
  );
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
