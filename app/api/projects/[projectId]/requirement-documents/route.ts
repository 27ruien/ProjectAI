import { after } from "next/server";
import { jsonResponse, requireTrustedMutationRequest } from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  generateRequirementDocument,
  listRequirementDocuments,
  reserveRequirementDocument,
} from "@/lib/focused-mvp/requirement-documents";
import { projectManagementErrorResponse } from "@/lib/project-management/http";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(await listRequirementDocuments({ principal, projectId, requestHeaders: request.headers }));
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const requestHeaders = new Headers(request.headers);
    const document = await reserveRequirementDocument({ principal, projectId, requestHeaders });
    after(async () => {
      try {
        await generateRequirementDocument({
          principal,
          projectId,
          requirementId: document.id,
          requestHeaders,
        });
      } catch {
        // The generator records a safe failure code on the reserved version.
      }
    });
    return jsonResponse({ document }, { status: 202 });
  } catch (error) {
    return projectManagementErrorResponse(error);
  }
}
