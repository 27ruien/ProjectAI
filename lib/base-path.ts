const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";

export const APP_BASE_PATH = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

export function withBasePath(path: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return path;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!APP_BASE_PATH || normalizedPath === APP_BASE_PATH || normalizedPath.startsWith(`${APP_BASE_PATH}/`)) {
    return normalizedPath;
  }

  return `${APP_BASE_PATH}${normalizedPath}`;
}
