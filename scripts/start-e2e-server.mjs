#!/usr/bin/env node

import { spawn } from "node:child_process";
import http from "node:http";

const publicPort = Number(process.env.PORT || process.env.PLAYWRIGHT_PORT || 3200);
const upstreamPort = Number(process.env.PLAYWRIGHT_UPSTREAM_PORT || publicPort + 1);
const host = "127.0.0.1";
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";
const assetPrefix = `${basePath}/assets/`;

const child = spawn(process.execPath, ["dist/standalone/server.js"], {
  env: {
    ...process.env,
    PORT: String(upstreamPort),
    HOST: host,
  },
  stdio: "inherit",
});

const proxy = http.createServer((request, response) => {
  const incomingUrl = new URL(request.url || "/", `http://${request.headers.host || host}`);
  const upstreamPath = incomingUrl.pathname.startsWith(assetPrefix)
    ? `${incomingUrl.pathname.slice(basePath.length)}${incomingUrl.search}`
    : `${incomingUrl.pathname}${incomingUrl.search}`;

  const upstream = http.request(
    {
      host,
      port: upstreamPort,
      method: request.method,
      path: upstreamPath,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end("Standalone application is starting.");
  });
  request.pipe(upstream);
});

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (!child.killed) child.kill("SIGTERM");
  proxy.close(() => process.exit(exitCode));
  proxy.closeAllConnections();
  setTimeout(() => process.exit(exitCode), 2_000).unref();
}

child.once("exit", (code, signal) => {
  if (stopping) return;
  process.stderr.write(
    `Standalone E2E server exited unexpectedly (${signal || code || "unknown"}).\n`,
  );
  stop(code || 1);
});

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(0));

proxy.listen(publicPort, host, () => {
  process.stdout.write(
    `E2E proxy running at http://${host}:${publicPort}${basePath || "/"}\n`,
  );
});
