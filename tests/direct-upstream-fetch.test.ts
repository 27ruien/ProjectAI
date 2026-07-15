import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { fetchWithPublicHost } from "../scripts/lib/fetch-with-public-host";

test("direct multipart verification sends the public Host without forwarded headers", async (t) => {
  let observed:
    | { host?: string; origin?: string; forwardedHost?: string; contentType?: string; body: string }
    | undefined;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      observed = {
        host: request.headers.host,
        origin: request.headers.origin,
        forwardedHost: request.headers["x-forwarded-host"] as string | undefined,
        contentType: request.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8"),
      };
      response.setHeader("content-type", "application/json");
      response.setHeader("set-cookie", ["first=1; HttpOnly", "second=2; HttpOnly"]);
      response.end('{"ok":true}');
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const form = new FormData();
  form.set("file", new Blob(["synthetic verification"]), "probe.txt");
  const response = await fetchWithPublicHost(
    `http://127.0.0.1:${address.port}/tool/projectai-staging/api/projects/project-001/documents`,
    "https://gridworks.cn",
    {
      method: "POST",
      headers: { origin: "https://gridworks.cn" },
      body: form,
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(observed?.host, "gridworks.cn");
  assert.equal(observed?.origin, "https://gridworks.cn");
  assert.equal(observed?.forwardedHost, undefined);
  assert.match(observed?.contentType || "", /^multipart\/form-data; boundary=/);
  assert.match(observed?.body || "", /filename="probe\.txt"/);
  assert.match(observed?.body || "", /synthetic verification/);
});
