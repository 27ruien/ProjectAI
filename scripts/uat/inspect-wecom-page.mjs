#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function parseEnvironment(source) {
  const result = {};
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error("Private WeCom config is invalid.");
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

const localDirectory = path.resolve(".local");
const configPath = path.join(localDirectory, "wecom-uat.env");
const reportPath = path.join(localDirectory, "wecom-inspection.json");
const values = parseEnvironment(await readFile(configPath, "utf8"));
const board = new URL(values.WECOM_TASK_BOARD_URL);
if (board.origin !== "https://doc.weixin.qq.com") throw new Error("Unexpected WeCom origin.");
const headed = process.argv.includes("--headed");
const waitForLogin = headed && process.argv.includes("--wait-for-login");
const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
let report;
try {
  const page = context.pages()[0] ?? await context.newPage();
  const response = await page.goto(board.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2_000);
  const finalOrigin = new URL(page.url()).origin;
  if (finalOrigin !== board.origin) {
    report = {
      inspectedAt: new Date().toISOString(),
      target: "https://doc.weixin.qq.com/smartsheet/[REDACTED]",
      httpStatus: response?.status() ?? null,
      approvedOriginRetained: false,
      loginRequired: true,
      editableControlsDetected: false,
      dom: null,
      blocker: "REDIRECTED_OUTSIDE_APPROVED_ORIGIN",
    };
  } else {
    if (waitForLogin) {
      process.stdout.write("Waiting for manual login in the isolated browser; credentials and session data will not be read or exported.\n");
      await page.waitForFunction(() => {
        const bodyText = document.body?.innerText ?? "";
        const login = /登录|扫码|sign\s*in|log\s*in/iu.test(bodyText.slice(0, 20_000));
        const interactive = document.querySelectorAll("button,[role='button'],input,textarea,[contenteditable='true']").length > 0;
        return !login && interactive;
      }, undefined, { timeout: 600_000 });
      await page.waitForTimeout(2_000);
    }
    const dom = await page.evaluate(() => {
      const shadowRoots = [...document.querySelectorAll("*")]
        .filter((element) => Boolean(element.shadowRoot)).length;
      const bodyText = document.body?.innerText ?? "";
      return {
        iframeCount: document.querySelectorAll("iframe").length,
        canvasCount: document.querySelectorAll("canvas").length,
        shadowRootCount: shadowRoots,
        tableCount: document.querySelectorAll("table,[role='grid'],[role='treegrid']").length,
        editableControlCount: document.querySelectorAll("input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),[contenteditable='true']").length,
        buttonCount: document.querySelectorAll("button,[role='button']").length,
        passwordInputCount: document.querySelectorAll("input[type='password']").length,
        loginLanguageDetected: /登录|扫码|sign\s*in|log\s*in/iu.test(bodyText.slice(0, 20_000)),
      };
    });
    const loginRequired = dom.passwordInputCount > 0 || dom.loginLanguageDetected;
    const structuralBlocker = !loginRequired && dom.canvasCount > 0 && dom.tableCount === 0
      ? "CANVAS_WITHOUT_SEMANTIC_GRID"
      : null;
    report = {
      inspectedAt: new Date().toISOString(),
      target: "https://doc.weixin.qq.com/smartsheet/[REDACTED]",
      httpStatus: response?.status() ?? null,
      approvedOriginRetained: true,
      loginRequired,
      editableControlsDetected: !loginRequired && dom.editableControlCount > 0,
      dom: {
        iframeCount: dom.iframeCount,
        canvasCount: dom.canvasCount,
        shadowRootCount: dom.shadowRootCount,
        tableCount: dom.tableCount,
        editableControlCount: dom.editableControlCount,
        buttonCount: dom.buttonCount,
      },
      blocker: loginRequired ? "MANUAL_LOGIN_REQUIRED" : structuralBlocker,
    };
  }
} catch (error) {
  report = {
    inspectedAt: new Date().toISOString(),
    target: "https://doc.weixin.qq.com/smartsheet/[REDACTED]",
    httpStatus: null,
    approvedOriginRetained: false,
    loginRequired: null,
    editableControlsDetected: false,
    dom: null,
    blocker: error instanceof Error && error.name === "TimeoutError" ? "PAGE_LOAD_TIMEOUT" : "PAGE_ACCESS_FAILED",
  };
} finally {
  await context.close();
  await browser.close();
}
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
await chmod(reportPath, 0o600);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
