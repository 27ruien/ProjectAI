const defaultBasePath = "/tool/projectai";

function normalizeBasePath(value: string) {
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function configuredBasePath() {
  const target = process.env.PLAYWRIGHT_BASE_URL?.trim();
  if (target) {
    const pathname = new URL(target).pathname.replace(/\/+$/, "");
    if (pathname && pathname !== "/") return normalizeBasePath(pathname);
  }
  return normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH?.trim() || defaultBasePath);
}

export function appPath(pathname: string) {
  const path = pathname === "/" ? "" : `/${pathname.replace(/^\/+/, "")}`;
  return `${configuredBasePath()}${path}`;
}

export function appStorageKey(name: string) {
  const namespace = configuredBasePath().includes("projectai-staging")
    ? "project-ai-os:staging"
    : "project-ai-os";
  return `${namespace}:${name}`;
}
