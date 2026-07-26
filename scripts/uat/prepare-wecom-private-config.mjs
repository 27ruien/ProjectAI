#!/usr/bin/env node

import { chmod, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("A private request/config source path is required.");
const source = await readFile(path.resolve(sourcePath), "utf8");
const candidates = source.match(/https:\/\/doc\.weixin\.qq\.com\/smartsheet\/[^\s`<>]+/gu) ?? [];
const unique = [...new Set(candidates)].filter((candidate) => {
  try {
    return new URL(candidate).searchParams.has("scode");
  } catch {
    return false;
  }
});
if (unique.length !== 1) throw new Error("Expected exactly one private WeCom Smart Sheet URL.");
const board = new URL(unique[0]);
if (
  board.origin !== "https://doc.weixin.qq.com" ||
  !board.pathname.startsWith("/smartsheet/") ||
  !board.searchParams.has("scode")
) {
  throw new Error("Private WeCom URL does not match the approved exact origin and path.");
}
const localDirectory = path.resolve(".local");
const outputPath = path.join(localDirectory, "wecom-uat.env");
await mkdir(localDirectory, { recursive: true, mode: 0o700 });
const output = [
  "PROJECTAI_ALLOWED_ORIGIN=https://gridworks.cn",
  "WECOM_ALLOWED_ORIGIN=https://doc.weixin.qq.com",
  `WECOM_TASK_BOARD_URL=${board.toString()}`,
  "",
].join("\n");
try {
  const file = await open(outputPath, "wx", 0o600);
  try {
    await file.writeFile(output, "utf8");
  } finally {
    await file.close();
  }
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const existing = await readFile(outputPath, "utf8");
  if (existing !== output) throw new Error("Private WeCom config already exists with different contents.");
}
await chmod(outputPath, 0o600);
process.stdout.write("Private WeCom UAT config prepared for the approved exact origin; the full URL was not printed.\n");
