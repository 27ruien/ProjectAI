import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const outputDirectory = "dist/wecom-timesheet-extension";
const packagePath = "release/wecom-timesheet-extension-v0.1.0.zip";

describe("WeCom MV3 release package", () => {
  it("uses a narrow MV3 permission and content-script contract", async () => {
    const manifest = JSON.parse(
      await readFile(`${outputDirectory}/manifest.json`, "utf8"),
    );
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
    assert.deepEqual(manifest.host_permissions, [
      "https://gridworks.cn/*",
      "https://doc.weixin.qq.com/*",
    ]);
    assert.deepEqual(manifest.optional_host_permissions, []);
    assert.equal(manifest.content_scripts[0].all_frames, false);
    assert.deepEqual(manifest.content_scripts.map((entry) => entry.js), [
      ["projectai-content.js"],
      ["wecom-content.js"],
    ]);
    assert.doesNotMatch(JSON.stringify(manifest), /<all_urls>|https:\/\/\*\//);
  });

  it("contains only root-level runtime assets and no source maps or local config", () => {
    const entries = execFileSync("unzip", ["-Z1", packagePath], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    assert.ok(entries.includes("manifest.json"));
    assert.ok(entries.includes("service-worker.js"));
    assert.ok(entries.includes("wecom-content.js"));
    assert.ok(entries.includes("selector-config.example.json"));
    assert.ok(entries.includes("selector-config.default.json"));
    assert.ok(entries.includes("build-bindings.json"));
    assert.equal(
      entries.some((entry) =>
        /(?:^|\/)(?:\.env|selector-config\.local)|\.(?:map|log)$/i.test(entry),
      ),
      false,
    );
    assert.equal(entries.some((entry) => entry.startsWith("wecom-timesheet-extension/")), false);
    assert.equal(
      entries.some((entry) => /(?:cookies?|login data|local state|storage-state|browser-profile|playwright-auth)/i.test(entry)),
      false,
    );
    const archiveText = execFileSync("unzip", ["-p", packagePath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.doesNotMatch(archiveText, /scode=|\/smartsheet\/s3_|<all_urls>|\*:\/\/\*\/\*/i);
  });

  it("has no adapter selector for final submission", async () => {
    const selectorConfig = await readFile(
      `${outputDirectory}/selector-config.example.json`,
      "utf8",
    );
    assert.doesNotMatch(selectorConfig, /final|submit.?all|daily.?submit/i);
  });

  it("ships a review build with the exact approved WeCom origin but no full board URL", async () => {
    const bindings = JSON.parse(
      await readFile(`${outputDirectory}/build-bindings.json`, "utf8"),
    );
    assert.deepEqual(bindings, {
      extensionVersion: "0.1.0",
      projectAiOrigin: "https://gridworks.cn",
      wecomOrigin: "https://doc.weixin.qq.com",
      wecomBoardConfigured: false,
      manualActualSyncAllowed: false,
      selectorConfigSource: "review-default",
      selectorConfigSha256: bindings.selectorConfigSha256,
    });
    assert.match(bindings.selectorConfigSha256, /^[a-f0-9]{64}$/);
  });

  it("rejects mismatched real board and allowed origins before building", () => {
    assert.throws(() =>
      execFileSync(process.execPath, ["scripts/build-wecom-timesheet-extension.mjs"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PROJECTAI_ALLOWED_ORIGIN: "https://gridworks.cn",
          WECOM_ALLOWED_ORIGIN: "https://work.example.test",
          WECOM_TASK_BOARD_URL: "https://different.example.test/tasks",
          WECOM_SELECTOR_CONFIG_PATH:
            "extensions/wecom-timesheet/static/selector-config.example.json",
        },
        stdio: "pipe",
      }),
    );
  });
});
