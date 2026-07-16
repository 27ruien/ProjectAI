const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ["pdf", "docx", "xlsx", "pptx", "txt", "md"] as const;

export type SupportedFileExtension = (typeof SUPPORTED_EXTENSIONS)[number];

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("MAX_UPLOAD_BYTES must be a positive safe integer.");
  }
  return parsed;
}

export function maxUploadBytes(): number {
  return positiveInteger(process.env.MAX_UPLOAD_BYTES, DEFAULT_MAX_UPLOAD_BYTES);
}

export function allowedUploadExtensions(): ReadonlySet<SupportedFileExtension> {
  const configured = (process.env.UPLOAD_ALLOWED_EXTENSIONS || SUPPORTED_EXTENSIONS.join(","))
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const allowed = configured.filter(
    (value): value is SupportedFileExtension =>
      SUPPORTED_EXTENSIONS.includes(value as SupportedFileExtension),
  );
  if (allowed.length !== configured.length || allowed.length === 0) {
    throw new Error("UPLOAD_ALLOWED_EXTENSIONS contains unsupported values.");
  }
  return new Set(allowed);
}

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  useSsl: boolean;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for object storage.`);
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} contains unsupported control characters.`);
  }
  return value;
}

function environmentBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

export function getObjectStorageConfig(): ObjectStorageConfig {
  const endpoint = required("OBJECT_STORAGE_ENDPOINT");
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("OBJECT_STORAGE_ENDPOINT must be a valid HTTP(S) origin.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error(
      "OBJECT_STORAGE_ENDPOINT must be an HTTP(S) origin without credentials, path, query, or fragment.",
    );
  }
  const useSsl = environmentBoolean("OBJECT_STORAGE_USE_SSL", parsed.protocol === "https:");
  if ((useSsl && parsed.protocol !== "https:") || (!useSsl && parsed.protocol !== "http:")) {
    throw new Error("OBJECT_STORAGE_USE_SSL must match OBJECT_STORAGE_ENDPOINT.");
  }
  const region = required("OBJECT_STORAGE_REGION");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(region)) {
    throw new Error("OBJECT_STORAGE_REGION is invalid.");
  }
  const bucket = required("OBJECT_STORAGE_BUCKET");
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes("..") ||
    bucket.includes(".-") ||
    bucket.includes("-.") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket) ||
    /^(?:xn--|sthree-|amzn-s3-demo-)/.test(bucket) ||
    /(?:-s3alias|--ol-s3|\.mrap|--x-s3|--table-s3)$/.test(bucket)
  ) {
    throw new Error("OBJECT_STORAGE_BUCKET must be a valid private S3 bucket name.");
  }
  const accessKeyId = required("OBJECT_STORAGE_ACCESS_KEY");
  const secretAccessKey = required("OBJECT_STORAGE_SECRET_KEY");
  if (
    accessKeyId.length < 3 ||
    accessKeyId.length > 128 ||
    secretAccessKey.length < 8 ||
    secretAccessKey.length > 256
  ) {
    throw new Error("Object storage credential lengths are invalid.");
  }
  return {
    endpoint: parsed.origin,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: environmentBoolean("OBJECT_STORAGE_FORCE_PATH_STYLE", true),
    useSsl,
  };
}
