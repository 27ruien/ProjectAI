import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const routeRoot = path.resolve("app/api/timesheets");

async function listRouteFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? listRouteFiles(target)
        : Promise.resolve(entry.name === "route.ts" ? [target] : []);
    }),
  );
  return nested.flat().sort();
}

describe("timesheet API authorization contracts", () => {
  it("requires a server-authenticated principal on every route", async () => {
    const files = await listRouteFiles(routeRoot);
    assert.equal(files.length, 9, "unexpected timesheet route count; review new routes explicitly");
    for (const file of files) {
      const source = await readFile(file, "utf8");
      assert.match(source, /await requireApiPrincipal\(request\.headers\)/, file);
    }
  });

  it("checks the trusted same-origin mutation boundary before authentication", async () => {
    const files = await listRouteFiles(routeRoot);
    let mutationCount = 0;
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const exportedMethods = [...source.matchAll(/export async function (POST|PATCH|DELETE)\b/g)];
      for (const method of exportedMethods) {
        mutationCount += 1;
        const methodBody = source.slice(method.index);
        const boundaryIndex = methodBody.indexOf("requireTrustedMutationRequest(request");
        const principalIndex = methodBody.indexOf("await requireApiPrincipal(request.headers)");
        assert.ok(boundaryIndex >= 0, `${file} ${method[1]} is missing the mutation boundary`);
        assert.ok(principalIndex >= 0, `${file} ${method[1]} is missing server authentication`);
        assert.ok(boundaryIndex < principalIndex, `${file} ${method[1]} authenticates before validating origin`);
      }
    }
    assert.equal(mutationCount, 8, "unexpected mutation handler count; review new handlers explicitly");
  });
});
