import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { documentProcessingErrorResponse } from "@/lib/documents/processing/http";
import { reindexDocumentVersion } from "@/lib/documents/processing/reindex-service";

type ReindexRouteContext = {
  params: Promise<{ projectId: string; documentId: string; versionId: string }>;
};

export async function POST(
  request: Request,
  context: ReindexRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId, versionId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const job = await reindexDocumentVersion({
      principal,
      projectId,
      documentId,
      versionId,
      requestHeaders: request.headers,
    });
    return jsonResponse(
      {
        ingestion: {
          status: job.status,
          generation: job.generation,
          parserVersion: job.parserVersion,
          chunkerVersion: job.chunkerVersion,
        },
      },
      { status: job.status === "pending" ? 202 : 200 },
    );
  } catch (error) {
    return documentProcessingErrorResponse(error);
  }
}
