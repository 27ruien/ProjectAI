const DEFAULTS = {
  pollMs: 2_000,
  leaseSeconds: 120,
  maxAttempts: 3,
  maxPages: 1_000,
  maxSlides: 1_000,
  maxSheets: 100,
  maxRows: 100_000,
  maxColumns: 1_000,
  maxCells: 500_000,
  maxCharacters: 10_000_000,
  maxSections: 20_000,
  maxChunks: 50_000,
  parseTimeoutMs: 120_000,
  chunkTargetChars: 1_800,
  chunkOverlapChars: 200,
  chunkMinChars: 120,
  parserVersion: "1",
  chunkerVersion: "1",
} as const;

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function version(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(value)) {
    throw new Error(`${name} must be a short version identifier.`);
  }
  return value;
}

export type DocumentProcessingConfig = {
  pollMs: number;
  leaseSeconds: number;
  maxAttempts: number;
  maxPages: number;
  maxSlides: number;
  maxSheets: number;
  maxRows: number;
  maxColumns: number;
  maxCells: number;
  maxCharacters: number;
  maxSections: number;
  maxChunks: number;
  parseTimeoutMs: number;
  chunkTargetChars: number;
  chunkOverlapChars: number;
  chunkMinChars: number;
  parserVersion: string;
  chunkerVersion: string;
};

export function getDocumentProcessingConfig(): DocumentProcessingConfig {
  const config: DocumentProcessingConfig = {
    pollMs: positiveInteger("DOCUMENT_WORKER_POLL_MS", DEFAULTS.pollMs),
    leaseSeconds: positiveInteger(
      "DOCUMENT_WORKER_LEASE_SECONDS",
      DEFAULTS.leaseSeconds,
    ),
    maxAttempts: positiveInteger(
      "DOCUMENT_WORKER_MAX_ATTEMPTS",
      DEFAULTS.maxAttempts,
    ),
    maxPages: positiveInteger("DOCUMENT_MAX_PAGES", DEFAULTS.maxPages),
    maxSlides: positiveInteger("DOCUMENT_MAX_SLIDES", DEFAULTS.maxSlides),
    maxSheets: positiveInteger("DOCUMENT_MAX_SHEETS", DEFAULTS.maxSheets),
    maxRows: positiveInteger("DOCUMENT_MAX_ROWS", DEFAULTS.maxRows),
    maxColumns: positiveInteger("DOCUMENT_MAX_COLUMNS", DEFAULTS.maxColumns),
    maxCells: positiveInteger("DOCUMENT_MAX_CELLS", DEFAULTS.maxCells),
    maxCharacters: positiveInteger(
      "DOCUMENT_MAX_CHARACTERS",
      DEFAULTS.maxCharacters,
    ),
    maxSections: positiveInteger("DOCUMENT_MAX_SECTIONS", DEFAULTS.maxSections),
    maxChunks: positiveInteger("DOCUMENT_MAX_CHUNKS", DEFAULTS.maxChunks),
    parseTimeoutMs: positiveInteger(
      "DOCUMENT_PARSE_TIMEOUT_MS",
      DEFAULTS.parseTimeoutMs,
    ),
    chunkTargetChars: positiveInteger(
      "DOCUMENT_CHUNK_TARGET_CHARS",
      DEFAULTS.chunkTargetChars,
    ),
    chunkOverlapChars: positiveInteger(
      "DOCUMENT_CHUNK_OVERLAP_CHARS",
      DEFAULTS.chunkOverlapChars,
    ),
    chunkMinChars: positiveInteger(
      "DOCUMENT_CHUNK_MIN_CHARS",
      DEFAULTS.chunkMinChars,
    ),
    parserVersion: version(
      "DOCUMENT_PARSER_VERSION",
      DEFAULTS.parserVersion,
    ),
    chunkerVersion: version(
      "DOCUMENT_CHUNKER_VERSION",
      DEFAULTS.chunkerVersion,
    ),
  };
  if (config.chunkOverlapChars >= config.chunkTargetChars) {
    throw new Error(
      "DOCUMENT_CHUNK_OVERLAP_CHARS must be smaller than DOCUMENT_CHUNK_TARGET_CHARS.",
    );
  }
  if (config.chunkMinChars > config.chunkTargetChars) {
    throw new Error(
      "DOCUMENT_CHUNK_MIN_CHARS must not exceed DOCUMENT_CHUNK_TARGET_CHARS.",
    );
  }
  return config;
}

export const DOCUMENT_WORKER_VERSION = "1";
