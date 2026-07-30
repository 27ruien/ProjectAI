import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import { retryDocumentEmbedding } from "@/lib/ai/embeddings/retry-service";
import { fileRouteErrorResponse } from "@/lib/files/http";

type RetryRouteContext = {
  params: Promise<{
    projectId: string;
    documentId: string;
    versionId: string;
  }>;
};

export async function POST(
  request: Request,
  context: RetryRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId, documentId, versionId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    const job = await retryDocumentEmbedding({
      principal,
      projectId,
      documentId,
      versionId,
      requestHeaders: request.headers,
    });
    return jsonResponse(
      { embedding: { status: job?.status ?? "succeeded" } },
      { status: job?.status === "pending" ? 202 : 200 },
    );
  } catch (error) {
    return fileRouteErrorResponse(error);
  }
}
