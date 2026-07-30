import { z } from "zod";
import { requireApiPrincipal } from "@/lib/auth/session";
import { buildArtifactExport } from "@/lib/workflows/export";
import { readWorkflowRun, recordWorkflowExport } from "@/lib/workflows/service";
import { workflowErrorResponse } from "@/lib/workflows/http";
import { WorkflowError } from "@/lib/workflows/errors";

const formatSchema = z.enum(["md", "docx", "xlsx", "txt"]);

export async function GET(request: Request, context: { params: Promise<{ projectId: string; runId: string; artifactId: string }> }) {
  try {
    const principal = await requireApiPrincipal(request.headers);
    const { projectId, runId, artifactId } = await context.params;
    const format = formatSchema.safeParse(new URL(request.url).searchParams.get("format"));
    if (!format.success) throw new WorkflowError(400, "WORKFLOW_EXPORT_FORMAT_INVALID", "导出格式无效");
    const detail = await readWorkflowRun({ principal, projectId, runId, requestHeaders: request.headers });
    const artifact = detail.artifacts.find((item) => item.id === artifactId);
    if (!artifact) throw new WorkflowError(404, "NOT_FOUND", "工作流产物不存在");
    const exported = await buildArtifactExport({ artifact, projectName: detail.run.displayName.split(" · ")[0] || "ProjectAI", format: format.data });
    await recordWorkflowExport({ principal, projectId, artifactId, format: format.data, bytes: exported.bytes, requestHeaders: request.headers });
    return new Response(Uint8Array.from(exported.bytes).buffer, { headers: { "content-type": exported.contentType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(exported.filename)}`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return workflowErrorResponse(error); }
}
