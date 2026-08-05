import { requireApiPrincipal } from "@/lib/auth/session";
import { safeAttachmentDisposition } from "@/lib/files/http";
import { getRequirementExport } from "@/lib/focused-mvp/requirement-documents";
import { requirementDocx, requirementExportFilename } from "@/lib/focused-mvp/requirement-export";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

type Context = { params: Promise<{ projectId: string; requirementId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId, requirementId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const format = new URL(request.url).searchParams.get("format") ?? "md";
    if (format !== "md" && format !== "docx") return new Response("Unsupported format", { status: 400 });
    const { projectName, document } = await getRequirementExport({ principal, projectId, requirementId, requestHeaders: request.headers });
    const bytes = format === "docx" ? await requirementDocx(document.markdown) : new TextEncoder().encode(document.markdown);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "content-type": format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/markdown; charset=utf-8",
        "content-disposition": safeAttachmentDisposition(requirementExportFilename(projectName, document.versionNumber, format)),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
