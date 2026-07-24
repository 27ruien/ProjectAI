import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { after, before, test } from "node:test";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";
const trustedHost = "gridworks.cn";

let port;
let serverProcess;
let serverOutput = "";

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function proxyRequest(
  path,
  {
    host = trustedHost,
    forwardedHost = trustedHost,
    forwardedProto = "https",
  } = {},
) {
  return new Promise((resolve, reject) => {
    const headers = { host };
    if (forwardedHost) headers["x-forwarded-host"] = forwardedHost;
    if (forwardedProto) headers["x-forwarded-proto"] = forwardedProto;
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers,
      },
      (response) => {
        response.resume();
        response.once("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? "",
          }),
        );
      },
    );
    request.once("error", reject);
    request.end();
  });
}

before(async () => {
  port = await availablePort();
  serverProcess = spawn(process.execPath, ["dist/standalone/server.js"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      VINEXT_TRUSTED_HOSTS: trustedHost,
      BETTER_AUTH_URL: `https://${trustedHost}${basePath}/api/auth`,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET || "proxy-redirect-test-secret-that-is-not-a-credential",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-2_000);
  });
  serverProcess.stderr.on("data", (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-2_000);
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (serverProcess.exitCode !== null) break;
    try {
      const response = await proxyRequest(`${basePath}/login`);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Standalone proxy test server did not become ready. ${serverOutput}`);
});

after(async () => {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  serverProcess.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => serverProcess.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (serverProcess.exitCode === null) {
    serverProcess.kill("SIGKILL");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
});

test("trusted reverse-proxy headers keep application redirects on HTTPS", async () => {
  const response = await proxyRequest(`${basePath}/`);
  assert.match(String(response.status), /^30[2378]$/);
  assert.equal(
    response.location,
    `https://${trustedHost}${basePath}/daily-report`,
  );
});

test("reviewed debug identity query is preserved before page routing", async () => {
  const response = await proxyRequest(`${basePath}/?debug=admin`);
  assert.match(String(response.status), /^30[2378]$/);
  assert.equal(
    response.location,
    `https://${trustedHost}${basePath}/login?debug=admin&returnTo=%2Fdaily-report`,
  );
});

test("untrusted proxy hosts and protocols are rejected without a redirect", async () => {
  for (const headers of [
    { forwardedHost: "attacker.invalid" },
    { host: "attacker.invalid", forwardedHost: "attacker.invalid" },
    { forwardedProto: "http" },
  ]) {
    const response = await proxyRequest(`${basePath}/`, headers);
    assert.equal(response.status, 404);
    assert.equal(response.location, "");
  }
});

test("allowlisted direct health-check traffic remains available", async () => {
  const response = await proxyRequest(`${basePath}/api/health`, {
    host: "127.0.0.1:3000",
    forwardedHost: null,
    forwardedProto: null,
  });
  assert.equal(response.status, 200);
  assert.equal(response.location, "");
});
