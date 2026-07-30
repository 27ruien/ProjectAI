import { readSignedAudioSource } from "@/lib/workflows/audio-service";
import { workflowErrorResponse } from "@/lib/workflows/http";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const source = await readSignedAudioSource({
      runId: url.searchParams.get("runId") || "",
      sourceId: url.searchParams.get("sourceId") || "",
      expires: url.searchParams.get("expires") || "",
      signature: url.searchParams.get("signature") || "",
    });
    return new Response(source.object.body, {
      headers: {
        "content-type": source.contentType,
        "content-length": String(source.object.size),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline; filename=meeting-audio",
      },
    });
  } catch (error) { return workflowErrorResponse(error); }
}
