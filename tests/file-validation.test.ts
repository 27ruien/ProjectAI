import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { after, before, describe, it } from "node:test";
import { resolvePendingDocumentUpload } from "../components/project/DocumentUploadDrawer";
import { getObjectStorageConfig } from "../lib/files/config";
import { FileOperationError } from "../lib/files/errors";
import {
  generateObjectKey,
  sanitizeOriginalFilename,
  validateUploadFile,
} from "../lib/files/validation";
import type {
  DocumentStorageStatus,
  ProjectDocumentDto,
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionDto,
  ProjectDocumentVersionsResponse,
} from "../types/documents";

type ZipEntry = {
  name: string;
  data: Uint8Array | string;
  encrypted?: boolean;
  deflate?: boolean;
};

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: ZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content =
      typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data);
    const compressed = entry.deflate ? deflateRawSync(content, { level: 9 }) : content;
    const method = entry.deflate ? 8 : 0;
    const flags = 0x800 | (entry.encrypted ? 0x1 : 0);
    const checksum = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.byteLength, 18);
    localHeader.writeUInt32LE(content.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.byteLength, 20);
    centralHeader.writeUInt32LE(content.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.byteLength + name.byteLength + compressed.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const office = {
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    core: "word/document.xml",
    partName: "/word/document.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  },
  xlsx: {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    core: "xl/workbook.xml",
    partName: "/xl/workbook.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  },
  pptx: {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    core: "ppt/presentation.xml",
    partName: "/ppt/presentation.xml",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  },
} as const;

function uploadVersion(
  storageStatus: DocumentStorageStatus,
  overrides: Partial<ProjectDocumentVersionDto> = {},
): ProjectDocumentVersionDto {
  return {
    id: "version-a",
    documentId: "document-a",
    versionNumber: 1,
    isCurrent: storageStatus === "stored",
    originalFilename: "project-plan.pdf",
    extension: "pdf",
    detectedMimeType: "application/pdf",
    sizeBytes: 128,
    storageStatus,
    failureCode: storageStatus === "failed" ? "STORAGE_UNAVAILABLE" : null,
    uploadedBy: { displayName: "项目经理 A" },
    createdAt: "2026-07-15T00:00:00.000Z",
    storedAt: storageStatus === "stored" ? "2026-07-15T00:00:01.000Z" : null,
    supersededAt: null,
    ...overrides,
  };
}

function uploadDocument(
  currentVersion: ProjectDocumentVersionDto | null = null,
  overrides: Partial<ProjectDocumentDto> = {},
): ProjectDocumentDto {
  return {
    id: "document-a",
    projectId: "project-a",
    displayName: "项目计划",
    status: currentVersion ? "active" : "pending",
    createdBy: { displayName: "项目经理 A" },
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    archivedAt: null,
    currentVersion,
    permissions: {
      canDownload: true,
      canUploadVersion: true,
      canArchive: true,
      canRestore: false,
      canSetCurrent: true,
    },
    ...overrides,
  };
}

function pendingUploadResponse(): ProjectDocumentUploadResponse {
  const version = uploadVersion("pending");
  return {
    document: uploadDocument(),
    version,
    replayed: true,
    uploadStatus: "pending",
  };
}

function officeFile(
  extension: keyof typeof office,
  extraEntries: ZipEntry[] = [],
  contentType: string = office[extension].contentType,
): File {
  const definition = office[extension];
  const types = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override ContentType="${contentType}" PartName="${definition.partName}"/></Types>`;
  const archive = zip([
    { name: "[Content_Types].xml", data: types },
    { name: definition.core, data: "<document/>" },
    ...extraEntries,
  ]);
  const archiveBuffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(archiveBuffer).set(archive);
  return new File(
    [archiveBuffer],
    `虚构项目资料.${extension}`,
    { type: definition.mime },
  );
}

async function rejectsInvalidOffice(file: File): Promise<void> {
  await assert.rejects(
    validateUploadFile(file),
    (error: unknown) =>
      error instanceof FileOperationError && error.code === "INVALID_OFFICE_CONTAINER",
  );
}

const preservedEnvironment = {
  allowed: process.env.UPLOAD_ALLOWED_EXTENSIONS,
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
  region: process.env.OBJECT_STORAGE_REGION,
  bucket: process.env.OBJECT_STORAGE_BUCKET,
  accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY,
  secretKey: process.env.OBJECT_STORAGE_SECRET_KEY,
  forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE,
  useSsl: process.env.OBJECT_STORAGE_USE_SSL,
};

before(() => {
  delete process.env.UPLOAD_ALLOWED_EXTENSIONS;
});

after(() => {
  const mapping: Record<keyof typeof preservedEnvironment, string> = {
    allowed: "UPLOAD_ALLOWED_EXTENSIONS",
    endpoint: "OBJECT_STORAGE_ENDPOINT",
    region: "OBJECT_STORAGE_REGION",
    bucket: "OBJECT_STORAGE_BUCKET",
    accessKey: "OBJECT_STORAGE_ACCESS_KEY",
    secretKey: "OBJECT_STORAGE_SECRET_KEY",
    forcePathStyle: "OBJECT_STORAGE_FORCE_PATH_STYLE",
    useSsl: "OBJECT_STORAGE_USE_SSL",
  };
  for (const [key, environmentName] of Object.entries(mapping) as Array<
    [keyof typeof preservedEnvironment, string]
  >) {
    const value = preservedEnvironment[key];
    if (value === undefined) delete process.env[environmentName];
    else process.env[environmentName] = value;
  }
});

describe("bounded Office Open XML validation", () => {
  for (const extension of ["docx", "xlsx", "pptx"] as const) {
    it(`accepts a minimal ${extension} with its exact core part and content type`, async () => {
      const validated = await validateUploadFile(officeFile(extension));
      assert.equal(validated.extension, extension);
      assert.equal(validated.detectedMimeType, office[extension].mime);
      assert.match(validated.sha256, /^[0-9a-f]{64}$/);
    });
  }

  it("rejects a valid ZIP whose declared Office content type is wrong", async () => {
    await rejectsInvalidOffice(
      officeFile(
        "docx",
        [],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
      ),
    );
  });

  it("rejects macro content and macro binary entries", async () => {
    await rejectsInvalidOffice(
      officeFile("docx", [{ name: "word/vbaProject.bin", data: "macro" }]),
    );
    await rejectsInvalidOffice(
      officeFile(
        "docx",
        [],
        "application/vnd.ms-word.document.macroEnabled.main+xml",
      ),
    );
  });

  it("rejects encrypted entries and unsafe archive paths", async () => {
    await rejectsInvalidOffice(
      officeFile("docx", [{ name: "word/encrypted.xml", data: "secret", encrypted: true }]),
    );
    await rejectsInvalidOffice(
      officeFile("docx", [{ name: "word/../outside.xml", data: "outside" }]),
    );
  });

  it("rejects an entry with an excessive compression ratio", async () => {
    await rejectsInvalidOffice(
      officeFile("docx", [
        {
          name: "word/compression-bomb.xml",
          data: new Uint8Array(4 * 1024 * 1024),
          deflate: true,
        },
      ]),
    );
  });
});

describe("safe filename and object key handling", () => {
  it("removes paths and Unicode controls while preserving an extension within 255 bytes", () => {
    const sanitized = sanitizeOriginalFilename(
      `../客户资料/\u202e${"项目".repeat(100)}.pdf`,
    );
    assert.equal(sanitized.includes("/"), false);
    assert.equal(sanitized.includes("\\"), false);
    assert.equal(sanitized.includes("\u202e"), false);
    assert.ok(Buffer.byteLength(sanitized, "utf8") <= 255);
    assert.match(sanitized, /\.pdf$/);
  });

  it("rejects overlong object-key segments", () => {
    assert.throws(
      () => generateObjectKey("p".repeat(129), "document-id", "version-id"),
      (error: unknown) =>
        error instanceof FileOperationError && error.code === "INVALID_REQUEST",
    );
  });
});

describe("strict object storage configuration", () => {
  function configure(endpoint: string): void {
    process.env.OBJECT_STORAGE_ENDPOINT = endpoint;
    process.env.OBJECT_STORAGE_REGION = "us-east-1";
    process.env.OBJECT_STORAGE_BUCKET = "projectai-ci-files";
    process.env.OBJECT_STORAGE_ACCESS_KEY = "ci-access-key";
    process.env.OBJECT_STORAGE_SECRET_KEY = "ci-secret-key-value";
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = "true";
    process.env.OBJECT_STORAGE_USE_SSL = "false";
  }

  it("accepts an HTTP origin without retaining a trailing slash", () => {
    configure("http://127.0.0.1:9000/");
    assert.equal(getObjectStorageConfig().endpoint, "http://127.0.0.1:9000");
  });

  for (const endpoint of [
    "http://user:password@127.0.0.1:9000",
    "http://127.0.0.1:9000/private/path",
    "http://127.0.0.1:9000/?token=unsafe",
    "ftp://127.0.0.1:9000",
  ]) {
    it(`rejects unsafe endpoint ${endpoint}`, () => {
      configure(endpoint);
      assert.throws(() => getObjectStorageConfig());
    });
  }
});

describe("pending document upload status polling", () => {
  it("waits for the exact project document version to become stored", async () => {
    let elapsedMs = 0;
    let loadCount = 0;
    const loadVersions = async (
      projectId: string,
      documentId: string,
    ): Promise<ProjectDocumentVersionsResponse> => {
      assert.equal(projectId, "project-a");
      assert.equal(documentId, "document-a");
      loadCount += 1;
      const targetVersion = uploadVersion(loadCount === 1 ? "pending" : "stored");
      return {
        document: uploadDocument(targetVersion),
        versions: [
          uploadVersion("stored", {
            id: "unrelated-version",
            versionNumber: 2,
          }),
          targetVersion,
        ],
      };
    };

    const result = await resolvePendingDocumentUpload(
      "project-a",
      pendingUploadResponse(),
      {
        intervalMs: 10,
        timeoutMs: 100,
        now: () => elapsedMs,
        wait: async (milliseconds) => {
          elapsedMs += milliseconds;
        },
        loadVersions,
      },
    );

    assert.equal(loadCount, 2);
    assert.equal(result.uploadStatus, "stored");
    assert.equal(result.version.id, "version-a");
    assert.equal(result.version.storageStatus, "stored");
    assert.equal(result.document.projectId, "project-a");
  });

  it("returns a failed terminal status so the drawer can show Retry", async () => {
    const result = await resolvePendingDocumentUpload(
      "project-a",
      pendingUploadResponse(),
      {
        timeoutMs: 100,
        loadVersions: async () => ({
          document: uploadDocument(),
          versions: [uploadVersion("failed")],
        }),
      },
    );

    assert.equal(result.uploadStatus, "failed");
    assert.equal(result.version.failureCode, "STORAGE_UNAVAILABLE");
  });

  it("stops after a bounded timeout instead of treating pending as success", async () => {
    let elapsedMs = 0;
    let loadCount = 0;
    await assert.rejects(
      resolvePendingDocumentUpload("project-a", pendingUploadResponse(), {
        intervalMs: 10,
        timeoutMs: 20,
        now: () => elapsedMs,
        wait: async (milliseconds) => {
          elapsedMs += milliseconds;
        },
        loadVersions: async () => {
          loadCount += 1;
          return {
            document: uploadDocument(),
            versions: [uploadVersion("pending")],
          };
        },
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "UPLOAD_PENDING",
    );
    assert.equal(elapsedMs, 20);
    assert.equal(loadCount, 2);
  });

  it("aborts a stalled status request when the deadline expires", async () => {
    await assert.rejects(
      resolvePendingDocumentUpload("project-a", pendingUploadResponse(), {
        timeoutMs: 20,
        now: () => 0,
        loadVersions: async (_projectId, _documentId, signal) =>
          new Promise<ProjectDocumentVersionsResponse>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new Error("status request aborted")),
              { once: true },
            );
          }),
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "UPLOAD_PENDING",
    );
  });

  it("fails closed when the status response breaks the project binding", async () => {
    await assert.rejects(
      resolvePendingDocumentUpload("project-a", pendingUploadResponse(), {
        timeoutMs: 100,
        loadVersions: async () => ({
          document: uploadDocument(null, { projectId: "project-b" }),
          versions: [uploadVersion("stored")],
        }),
      }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "INVALID_RESPONSE",
    );
  });
});
