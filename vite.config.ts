import vinext from "vinext";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// Cloudflare's Vite environment applies browser export conditions to package
// subpaths. The AWS SDK publishes a browser runtime for S3, but its extensionless
// relative import is not remapped by Rolldown. Resolve that one entry explicitly
// so the bundled server uses the Fetch handler instead of mixing Node runtime
// code with browser-only @aws-sdk/core symbols.
function awsSdkS3RuntimeCompat(): Plugin {
  const browserRuntime = resolve(
    process.cwd(),
    "node_modules/@aws-sdk/client-s3/dist-es/runtimeConfig.browser.js",
  );
  const nodeSerdeRuntime = resolve(
    process.cwd(),
    "node_modules/@smithy/core/dist-es/submodules/serde/index.js",
  );

  return {
    name: "projectai:aws-sdk-s3-runtime-compat",
    enforce: "pre",
    resolveId(source, importer) {
      // Vinext's standalone server exposes Node Readable responses even when
      // the S3 client uses its Fetch handler. Smithy's Node serde supports
      // Node, Web and Blob streams, whereas its browser collector supports
      // only the latter two.
      if (source === "@smithy/core/serde") return nodeSerdeRuntime;
      if (
        source === "./runtimeConfig" &&
        importer?.endsWith("/node_modules/@aws-sdk/client-s3/dist-es/S3Client.js")
      ) {
        return browserRuntime;
      }
    },
  };
}

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      awsSdkS3RuntimeCompat(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
