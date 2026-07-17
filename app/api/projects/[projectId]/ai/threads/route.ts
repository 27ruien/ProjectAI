import {
  jsonResponse,
  requireTrustedMutationRequest,
} from "@/lib/auth/http";
import { requireApiPrincipal } from "@/lib/auth/session";
import {
  createProjectAssistantThread,
  listProjectAssistantThreads,
  projectAssistantErrorResponse,
} from "@/lib/ai/project-assistant";

type ThreadsRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(
  request: Request,
  context: ThreadsRouteContext,
): Promise<Response> {
  try {
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse({
      threads: await listProjectAssistantThreads({
        principal,
        projectId,
        requestHeaders: request.headers,
      }),
    });
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: ThreadsRouteContext,
): Promise<Response> {
  try {
    requireTrustedMutationRequest(request);
    const { projectId } = await context.params;
    const principal = await requireApiPrincipal(request.headers);
    return jsonResponse(
      {
        thread: await createProjectAssistantThread({
          principal,
          projectId,
          requestHeaders: request.headers,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return projectAssistantErrorResponse(error);
  }
}
