import type { NextConfig } from "next";

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

const nextConfig: NextConfig = {
  basePath,
  output: "standalone",
  // Vinext applies the server-action multipart limit to progressive
  // multipart POSTs before the App Router route handler runs. Keep this
  // transport limit above the 50 MiB business limit so document uploads can
  // reach the route, while MAX_UPLOAD_BYTES remains the authoritative file
  // size policy.
  experimental: {
    serverActions: {
      bodySizeLimit: "64mb",
    },
  },
};

export default nextConfig;
