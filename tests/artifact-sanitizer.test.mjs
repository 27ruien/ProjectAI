import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const execFileAsync = promisify(execFile);
const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);
const sanitizer = new URL("../scripts/sanitize-test-artifacts.mjs", import.meta.url);
const requiredScreenshots = [
  "screenshots/login.png",
  "screenshots/dashboard-admin.png",
  "screenshots/projects-manager-a.png",
  "screenshots/project-a-overview.png",
  "screenshots/project-access-denied.png",
  "screenshots/viewer-readonly.png",
];

function sanitizerEnvironment(overrides = {}) {
  return {
    ...process.env,
    CI: "false",
    DATABASE_URL: "",
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "projectai-sanitizer-test-"));
  const report = path.join(root, "playwright-report");
  const archiveSource = path.join(root, "archive-source");
  await mkdir(report);
  await mkdir(archiveSource);
  return { root, report, archiveSource };
}

test("sanitizes the ZIP embedded in a Playwright HTML report", async () => {
  const { root, report, archiveSource } = await fixture();
  const secret = "sanitizer-test-password-Aa1!";
  try {
    await writeFile(
      path.join(archiveSource, "trace.trace"),
      `${JSON.stringify({ password: secret, cookie: `session_token=${secret}` })}\n`,
    );
    const sourceArchive = path.join(root, "source.zip");
    await execFileAsync("zip", ["-q", "-r", sourceArchive, "."], {
      cwd: archiveSource,
    });
    const encoded = (await readFile(sourceArchive)).toString("base64");
    await writeFile(
      path.join(report, "index.html"),
      `<template id="playwrightReportBase64">data:application/zip;base64,${encoded}</template>`,
    );

    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ BETTER_AUTH_SECRET: secret }),
    });

    const sanitizedHtml = await readFile(
      path.join(root, "product-review-evidence/playwright-report/index.html"),
      "utf8",
    );
    assert.doesNotMatch(sanitizedHtml, new RegExp(secret));
    const match = sanitizedHtml.match(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/);
    assert.ok(match, "sanitized report should retain a rebuilt embedded archive");
    const rebuiltArchive = path.join(root, "rebuilt.zip");
    await writeFile(rebuiltArchive, Buffer.from(match[1], "base64"));
    const { stdout } = await execFileAsync("unzip", ["-p", rebuiltArchive, "trace.trace"]);
    assert.doesNotMatch(stdout, new RegExp(secret));
    assert.match(stdout, /\[REDACTED\]/);

    const reportJson = JSON.parse(
      await readFile(
        path.join(root, "product-review-evidence/sanitization-report.json"),
        "utf8",
      ),
    );
    assert.equal(reportJson.status, "passed");
    assert.equal(reportJson.embeddedArchivesSanitized, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed for an invalid embedded report archive", async () => {
  const { root, report } = await fixture();
  try {
    await writeFile(
      path.join(report, "copied-report.txt"),
      "<template>DATA : APPLICATION/ZIP ; BASE64 ,\nZm9v</template>",
    );
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment(),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sanitizes renamed and nested ZIPs, gzip streams, paths, and Session data", async () => {
  const { root, report } = await fixture();
  const secret = "sanitizer-nested-secret-Aa1!";
  const sessionValue = "opaque-session-value-not-loaded-from-the-database";
  const nestedSource = path.join(root, "nested-source");
  const outerSource = path.join(root, "outer-source");
  await mkdir(nestedSource);
  await mkdir(outerSource);

  try {
    await writeFile(
      path.join(nestedSource, `trace-${secret}.data`),
      `password=${secret}\nsession_token=${sessionValue}\n`,
    );
    const nestedArchive = path.join(root, "nested-source.zip");
    await execFileAsync("zip", ["-q", "-r", nestedArchive, "."], {
      cwd: nestedSource,
    });
    await writeFile(
      path.join(outerSource, "nested.bin"),
      await readFile(nestedArchive),
    );
    const renamedArchive = path.join(report, "renamed.bin");
    await execFileAsync("zip", ["-q", "-r", renamedArchive, "."], {
      cwd: outerSource,
    });

    await writeFile(
      path.join(report, "compressed.payload"),
      await gzipAsync(Buffer.from(`password=${secret}\nsession_token=${sessionValue}\n`)),
    );
    await writeFile(
      path.join(report, "copied-report.txt"),
      `<template>DATA:APPLICATION/ZIP;BASE64,\n${(
        await readFile(nestedArchive)
      ).toString("base64")}</template>`,
    );

    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ BETTER_AUTH_SECRET: secret }),
    });

    const evidenceRoot = path.join(root, "product-review-evidence/playwright-report");
    const sanitizedOuter = path.join(evidenceRoot, "renamed.bin");
    const { stdout: nestedBuffer } = await execFileAsync(
      "unzip",
      ["-p", sanitizedOuter, "nested.bin"],
      { encoding: "buffer" },
    );
    const rebuiltNested = path.join(root, "rebuilt-nested.zip");
    await writeFile(rebuiltNested, nestedBuffer);
    const { stdout: nestedNames } = await execFileAsync("unzip", ["-Z1", rebuiltNested]);
    const { stdout: nestedText } = await execFileAsync("unzip", ["-p", rebuiltNested]);
    assert.doesNotMatch(nestedNames, new RegExp(secret));
    assert.doesNotMatch(nestedText, new RegExp(secret));
    assert.doesNotMatch(nestedText, new RegExp(sessionValue));
    assert.match(nestedText, /\[REDACTED\]/);

    const gzipPayload = await gunzipAsync(
      await readFile(path.join(evidenceRoot, "compressed.payload")),
    );
    assert.doesNotMatch(gzipPayload.toString("utf8"), new RegExp(secret));
    assert.doesNotMatch(gzipPayload.toString("utf8"), new RegExp(sessionValue));

    const copiedReport = await readFile(
      path.join(evidenceRoot, "copied-report.txt"),
      "utf8",
    );
    const embeddedMatch = copiedReport.match(
      /data:application\/zip;base64,([A-Za-z0-9+/=]+)/,
    );
    assert.ok(embeddedMatch, "variant Data URI should be normalized and rebuilt");
    const embeddedArchive = path.join(root, "rebuilt-embedded.zip");
    await writeFile(embeddedArchive, Buffer.from(embeddedMatch[1], "base64"));
    const { stdout: embeddedText } = await execFileAsync("unzip", [
      "-p",
      embeddedArchive,
    ]);
    assert.doesNotMatch(embeddedText, new RegExp(secret));
    assert.doesNotMatch(embeddedText, new RegExp(sessionValue));

    const reportJson = JSON.parse(
      await readFile(
        path.join(root, "product-review-evidence/sanitization-report.json"),
        "utf8",
      ),
    );
    assert.equal(reportJson.status, "passed");
    assert.ok(reportJson.archivesSanitized >= 2);
    assert.ok(reportJson.embeddedArchivesSanitized >= 1);
    assert.ok(reportJson.gzipStreamsSanitized >= 1);
    assert.ok(reportJson.artifactNamesSanitized >= 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("closes alternate MIME, raw Data URI, split-path, and oversized cookie bypasses", async () => {
  const { root, report } = await fixture();
  const secret = "audit????Aa1!";
  const sessionValue = "opaque-cookie-session-value";
  const archiveSource = path.join(root, "bypass-archive-source");
  const encodedSecretPath = Buffer.from(secret, "utf8").toString("base64");
  const pathParts = encodedSecretPath.split("/");
  const secretPath = path.join(archiveSource, ...pathParts);
  await mkdir(path.dirname(secretPath), { recursive: true });

  try {
    await writeFile(secretPath, `password=${secret}\n`);
    await writeFile(
      path.join(archiveSource, encodeURIComponent(encodedSecretPath)),
      `password=${secret}\n`,
    );
    const sourceArchive = path.join(root, "bypass-source.zip");
    await execFileAsync("zip", ["-q", "-r", sourceArchive, "."], {
      cwd: archiveSource,
    });
    const archiveBuffer = await readFile(sourceArchive);
    const alternateMimePayload = archiveBuffer
      .toString("base64")
      .replace(/(.{60})/g, "$1%0A");
    const percentEncodedPayload = [...archiveBuffer]
      .map((byte) => `%${byte.toString(16).padStart(2, "0")}`)
      .join("");
    await writeFile(
      path.join(report, "alternate-mime.txt"),
      `<template>data:application/x-zip-compressed;base64,${alternateMimePayload}</template>`,
    );
    await writeFile(
      path.join(report, "octet-stream-mime.txt"),
      `<template>data:application/octet-stream;base64,${alternateMimePayload}</template>`,
    );
    await writeFile(
      path.join(report, "percent-encoded-mime.txt"),
      `<template>data:application/zip,${percentEncodedPayload}</template>`,
    );
    await writeFile(
      path.join(report, "cookie.data"),
      JSON.stringify({
        name: "projectai.session_token",
        domain: "example.test",
        path: "/",
        metadata: {
          source: "browser",
          retained: true,
          padding: "x".repeat(21_000),
        },
        value: sessionValue,
      }),
    );

    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ BETTER_AUTH_SECRET: secret }),
    });

    const evidenceRoot = path.join(root, "product-review-evidence/playwright-report");
    const cookieArtifact = await readFile(path.join(evidenceRoot, "cookie.data"), "utf8");
    assert.equal(cookieArtifact.includes(sessionValue), false);
    assert.match(cookieArtifact, /\[REDACTED\]/);

    const alternateMime = await readFile(
      path.join(evidenceRoot, "alternate-mime.txt"),
      "utf8",
    );
    assert.equal(alternateMime.includes(secret), false);
    const embeddedMatch = alternateMime.match(
      /data:application\/zip;base64,([A-Za-z0-9+/=]+)/,
    );
    assert.ok(embeddedMatch, "alternate ZIP MIME should be rebuilt canonically");

    const octetStreamMime = await readFile(
      path.join(evidenceRoot, "octet-stream-mime.txt"),
      "utf8",
    );
    assert.equal(octetStreamMime.includes(secret), false);
    assert.match(octetStreamMime, /data:application\/zip;base64,/);

    const percentEncodedMime = await readFile(
      path.join(evidenceRoot, "percent-encoded-mime.txt"),
      "utf8",
    );
    const percentEncodedMatch = percentEncodedMime.match(
      /data:application\/zip;base64,([A-Za-z0-9+/=]+)/,
    );
    assert.ok(percentEncodedMatch, "percent-encoded ZIP Data URI should be rebuilt");

    const embeddedArchive = path.join(root, "alternate-rebuilt.zip");
    await writeFile(embeddedArchive, Buffer.from(embeddedMatch[1], "base64"));
    const { stdout: names } = await execFileAsync("unzip", ["-Z1", embeddedArchive]);
    const { stdout: contents } = await execFileAsync("unzip", ["-p", embeddedArchive]);
    assert.equal(names.includes(encodedSecretPath), false);
    assert.equal(names.includes(encodeURIComponent(encodedSecretPath)), false);
    assert.equal(contents.includes(secret), false);
    const percentArchive = path.join(root, "percent-rebuilt.zip");
    await writeFile(percentArchive, Buffer.from(percentEncodedMatch[1], "base64"));
    const { stdout: percentContents } = await execFileAsync("unzip", [
      "-p",
      percentArchive,
    ]);
    assert.equal(percentContents.includes(secret), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed for structured Session data hidden in a binary artifact", async () => {
  const { root, report } = await fixture();
  const sessionValue = "opaque-binary-session-not-loaded-from-database";
  try {
    await writeFile(
      path.join(report, "binary.payload"),
      Buffer.concat([
        Buffer.from([0]),
        Buffer.from(`projectai.session_token=${sessionValue}\n`),
      ]),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment(),
      }),
    );
    await assert.rejects(
      readFile(
        path.join(
          root,
          "product-review-evidence/playwright-report/binary.payload",
        ),
      ),
    );
    await assert.rejects(
      readFile(path.join(root, "product-review-evidence/sanitization-report.json")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("redacts whitespace-folded Base64 secret variants", async () => {
  const { root, report } = await fixture();
  const secret = "sanitizer-whitespace-base64-secret-Aa1!";
  const foldedBase64 = Buffer.from(secret, "utf8")
    .toString("base64")
    .match(/.{1,8}/g)
    .join("\n ");
  try {
    await writeFile(path.join(report, "folded.log"), `encoded=${foldedBase64}\n`);
    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ BETTER_AUTH_SECRET: secret }),
    });
    const sanitized = await readFile(
      path.join(root, "product-review-evidence/playwright-report/folded.log"),
      "utf8",
    );
    assert.match(sanitized, /\[REDACTED\]/);
    assert.equal(sanitized.includes(foldedBase64), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails the sanitizer when an unsafe standalone archive must be removed", async () => {
  const { root, report } = await fixture();
  try {
    await writeFile(
      path.join(report, "invalid-archive.bin"),
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from("not-a-valid-zip"),
      ]),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment(),
      }),
    );
    assert.match(
      await readFile(
        path.join(
          root,
          "product-review-evidence/playwright-report/invalid-archive.bin.omitted.txt",
        ),
        "utf8",
      ),
      /omitted/i,
    );
    await assert.rejects(
      readFile(path.join(root, "product-review-evidence/sanitization-report.json")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires complete successful CI screenshots but accepts explicit failure evidence", async () => {
  const { root } = await fixture();
  const reviewRoot = path.join(root, "review-artifacts");
  try {
    await mkdir(reviewRoot);
    await writeFile(
      path.join(reviewRoot, "manifest.json"),
      JSON.stringify({
        commit: "test-commit",
        branch: "test-branch",
        environment: "test",
        version: "test",
        buildTime: "2026-07-13T00:00:00Z",
        status: "success",
        requiredScreenshots,
        screenshotFiles: [],
        missingScreenshots: requiredScreenshots,
        screenshotsComplete: false,
      }),
    );
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment({ CI: "true" }),
      }),
    );
    await assert.rejects(
      readFile(path.join(root, "product-review-evidence/sanitization-report.json")),
    );

    await writeFile(
      path.join(reviewRoot, "manifest.json"),
      JSON.stringify({
        commit: "test-commit",
        branch: "test-branch",
        environment: "test",
        version: "test",
        buildTime: "2026-07-13T00:00:00Z",
        status: "failure",
        requiredScreenshots,
        screenshotFiles: [],
        missingScreenshots: requiredScreenshots,
        screenshotsComplete: false,
      }),
    );
    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ CI: "true" }),
    });
    const failureReport = JSON.parse(
      await readFile(
        path.join(root, "product-review-evidence/sanitization-report.json"),
        "utf8",
      ),
    );
    assert.equal(failureReport.reviewStatus, "failure");
    assert.equal(failureReport.screenshotsComplete, false);
    assert.deepEqual(failureReport.missingReviewScreenshots, requiredScreenshots);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("accepts CI evidence only when the manifest and required screenshots exist", async () => {
  const { root } = await fixture();
  const reviewRoot = path.join(root, "review-artifacts");
  const screenshotsRoot = path.join(reviewRoot, "screenshots");
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  try {
    await mkdir(screenshotsRoot, { recursive: true });
    for (const screenshot of requiredScreenshots) {
      await writeFile(path.join(reviewRoot, screenshot), onePixelPng);
    }
    await writeFile(
      path.join(reviewRoot, "manifest.json"),
      JSON.stringify({
        commit: "test-commit",
        branch: "test-branch",
        environment: "test",
        version: "test",
        buildTime: "2026-07-13T00:00:00Z",
        status: "success",
        requiredScreenshots,
        screenshotFiles: requiredScreenshots,
        missingScreenshots: [],
        screenshotsComplete: true,
      }),
    );
    await execFileAsync(process.execPath, [sanitizer.pathname], {
      cwd: root,
      env: sanitizerEnvironment({ CI: "true" }),
    });
    const reportJson = JSON.parse(
      await readFile(
        path.join(root, "product-review-evidence/sanitization-report.json"),
        "utf8",
      ),
    );
    assert.equal(reportJson.status, "passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed when configured Session storage cannot be verified", async () => {
  const { root, report } = await fixture();
  try {
    await writeFile(path.join(report, "run.log"), "test failure\n");
    await assert.rejects(
      execFileAsync(process.execPath, [sanitizer.pathname], {
        cwd: root,
        env: sanitizerEnvironment({
          DATABASE_URL: "postgresql://user:password@127.0.0.1:1/unavailable",
          BETTER_AUTH_SECRET: "sanitizer-storage-failure-secret-Aa1!",
        }),
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
