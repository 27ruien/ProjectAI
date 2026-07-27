import type { NextConfig } from "next";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

const nextConfig: NextConfig = {
  basePath,
  output: "standalone",
  experimental: {
    // Vinext classifies multipart POSTs before App Route dispatch and otherwise
    // applies its 1 MiB Server Action default. Keep this bounded to the same
    // 52 MiB envelope enforced by the reviewed Staging reverse proxy.
    serverActions: { bodySizeLimit: "52mb" },
  },
};

export default nextConfig;
