#!/usr/bin/env node

import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REDACTED = "[REDACTED]";

function replaceBuffer(buffer, search, replacement = REDACTED) {
  const needle = Buffer.from(search, "utf8");
  if (needle.length === 0 || buffer.indexOf(needle) < 0) return buffer;
  const replacementBuffer = Buffer.from(replacement, "utf8");
  const parts = [];
  let offset = 0;
  for (let index = buffer.indexOf(needle, offset); index >= 0; index = buffer.indexOf(needle, offset)) {
    parts.push(buffer.subarray(offset, index), replacementBuffer);
    offset = index + needle.length;
  }
  parts.push(buffer.subarray(offset));
  return Buffer.concat(parts);
}

function appearsText(buffer) {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 0xc2) {
      printable += 1;
    }
  }
  return printable / sample.length > 0.85;
}

function sanitizeStructuredText(input) {
  return input
    .replace(
      /("name"\s*:\s*"(?:cookie|set-cookie|authorization)"\s*,\s*"value"\s*:\s*")[^"]*(")/gi,
      `$1${REDACTED}$2`,
    )
    .replace(
      /("value"\s*:\s*")[^"]*("\s*,\s*"name"\s*:\s*"(?:cookie|set-cookie|authorization)")/gi,
      `$1${REDACTED}$2`,
    )
    .replace(
      /("(?:cookie|set-cookie|authorization|sessionToken|session_token)"\s*:\s*")[^"]*(")/gi,
      `$1${REDACTED}$2`,
    )
    .replace(
      /((?:[A-Za-z0-9_-]+\.)?session_token(?:=|%3D))[^;\s"',}\\]+/gi,
      `$1${REDACTED}`,
    )
    .replace(/^(cookie|set-cookie|authorization):.*$/gim, `$1: ${REDACTED}`);
}

function containsUnredactedStructuredSecret(input) {
  return (
    /"name"\s*:\s*"(?:cookie|set-cookie|authorization)"\s*,\s*"value"\s*:\s*"(?!\[REDACTED\]")[^"]+"/i.test(input) ||
    /"value"\s*:\s*"(?!\[REDACTED\]")[^"]+"\s*,\s*"name"\s*:\s*"(?:cookie|set-cookie|authorization)"/i.test(input) ||
    /"(?:cookie|set-cookie|authorization|sessionToken|session_token)"\s*:\s*"(?!\[REDACTED\]")[^"]+"/i.test(input) ||
    /(?:[A-Za-z0-9_-]+\.)?session_token(?:=|%3D)(?!\[REDACTED\])[^;\s"',}\\]+/i.test(input)
  );
}

async function walkFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function secretVariants(values) {
  const variants = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.length < 8) continue;
    variants.add(value);
    variants.add(encodeURIComponent(value));
    const base64 = Buffer.from(value, "utf8").toString("base64");
    variants.add(base64);
    variants.add(base64.replace(/=+$/u, ""));
    variants.add(base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""));
  }
  return [...variants].filter((value) => value.length >= 8).sort((left, right) => right.length - left.length);
}

/**
 * @param {{ inputPath: string; outputPath: string; secretValues?: string[] }} input
 */
export async function sanitizePlaywrightTrace({ inputPath, outputPath, secretValues = [] }) {
  const input = path.resolve(inputPath);
  const output = path.resolve(outputPath);
  const inputStat = await lstat(input);
  if (!inputStat.isFile() || inputStat.isSymbolicLink()) {
    throw new Error("UAT_TRACE_INPUT_INVALID");
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "projectai-uat-trace-"));
  const extracted = path.join(temporaryRoot, "trace");
  const rebuilt = path.join(temporaryRoot, "trace.sanitized.zip");
  const secrets = secretVariants(secretValues);
  await mkdir(extracted);
  try {
    await execFileAsync("unzip", ["-qq", "-o", input, "-d", extracted]);
    const files = await walkFiles(extracted);
    for (const file of files) {
      let buffer = await readFile(file);
      for (const secret of secrets) buffer = replaceBuffer(buffer, secret);
      if (appearsText(buffer)) {
        buffer = Buffer.from(sanitizeStructuredText(buffer.toString("utf8")), "utf8");
      }
      await writeFile(file, buffer);
    }
    for (const file of files) {
      const buffer = await readFile(file);
      if (secrets.some((secret) => buffer.includes(Buffer.from(secret, "utf8")))) {
        throw new Error("UAT_TRACE_SECRET_REMAINS");
      }
      if (appearsText(buffer) && containsUnredactedStructuredSecret(buffer.toString("utf8"))) {
        throw new Error("UAT_TRACE_SESSION_METADATA_REMAINS");
      }
    }
    await execFileAsync("zip", ["-q", "-r", rebuilt, "."], { cwd: extracted });
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await rm(output, { force: true });
    await writeFile(output, await readFile(rebuilt), { mode: 0o600 });
    await access(output);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(input, { force: true });
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("Expected input and output trace paths.");
  await sanitizePlaywrightTrace({ inputPath, outputPath });
  process.stdout.write(`Sanitized UAT trace written to ${path.relative(process.cwd(), outputPath)}.\n`);
}
