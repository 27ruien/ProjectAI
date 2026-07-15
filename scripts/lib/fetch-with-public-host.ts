import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const BODYLESS_RESPONSE_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Sends a request to an internal upstream while preserving the reviewed public
 * Host used by Origin checks. Native fetch does not allow callers to override
 * Host, so multipart requests would otherwise be rejected by Vinext before the
 * application route runs.
 */
export async function fetchWithPublicHost(
  url: string,
  publicOrigin: string,
  init: RequestInit = {},
): Promise<Response> {
  const target = new URL(url);
  const publicUrl = new URL(publicOrigin);
  if (target.origin === publicUrl.origin) return fetch(url, init);
  if (!(["http:", "https:"] as const).includes(target.protocol as "http:" | "https:")) {
    throw new Error("Direct upstream verification requires an HTTP(S) target.");
  }

  const prepared = new Request(url, { ...init, redirect: "manual" });
  const body = prepared.body
    ? Buffer.from(await prepared.arrayBuffer())
    : undefined;
  const headers = Object.fromEntries(prepared.headers.entries());
  headers.host = publicUrl.host;
  if (body) headers["content-length"] = String(body.byteLength);

  return new Promise<Response>((resolve, reject) => {
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = transport(
      target,
      { method: prepared.method, headers },
      (incoming) => {
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          const name = incoming.rawHeaders[index];
          const value = incoming.rawHeaders[index + 1];
          if (name && value !== undefined) responseHeaders.append(name, value);
        }

        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer | Uint8Array | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          const status = incoming.statusCode;
          if (!status) {
            reject(new Error("Direct upstream verification returned no status."));
            return;
          }
          const bytes = Buffer.concat(chunks);
          const responseBody =
            BODYLESS_RESPONSE_STATUSES.has(status) || prepared.method === "HEAD"
              ? null
              : bytes;
          resolve(
            new Response(responseBody, {
              status,
              statusText: incoming.statusMessage,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    outgoing.setTimeout(30_000, () => {
      outgoing.destroy(new Error("Direct upstream verification timed out."));
    });
    outgoing.on("error", reject);
    if (body) outgoing.end(body);
    else outgoing.end();
  });
}
