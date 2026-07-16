import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getObjectStorageConfig } from "./config";

export type StoredObjectMetadata = {
  size: number;
  etag: string | null;
  sha256: string | null;
};

export type ObjectStorageEntry = StoredObjectMetadata & {
  key: string;
  lastModified?: Date;
};

export interface ObjectStorage {
  putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    sha256: string;
  }): Promise<StoredObjectMetadata>;
  getObject(
    key: string,
  ): Promise<{ body: ReadableStream<Uint8Array> } & StoredObjectMetadata>;
  headObject(key: string): Promise<StoredObjectMetadata | null>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string): Promise<ObjectStorageEntry[]>;
}

function cleanEtag(value: string | undefined): string | null {
  return value ? value.replace(/^"|"$/g, "") : null;
}

function cleanSha256(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function safeContentLength(value: number | undefined): number {
  const size = value ?? 0;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("Object content length is invalid.");
  }
  return size;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    const config = getObjectStorageConfig();
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      // The bundled Fetch runtime also runs in the standalone Node server.
      // Pinning the standard mode prevents browser-only mobile-environment
      // detection while preserving the SDK's normal retry strategy.
      defaultsMode: "standard",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    sha256: string;
  }): Promise<StoredObjectMetadata> {
    const sha256 = cleanSha256(input.sha256);
    if (!sha256) throw new Error("Object SHA-256 metadata is invalid.");
    const response = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ContentType: input.contentType,
        Metadata: { sha256 },
      }),
    );
    return {
      size: input.body.byteLength,
      etag: cleanEtag(response.ETag),
      sha256,
    };
  }

  async getObject(
    key: string,
  ): Promise<{ body: ReadableStream<Uint8Array> } & StoredObjectMetadata> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error("Object body is missing.");
    return {
      body: response.Body.transformToWebStream(),
      size: safeContentLength(response.ContentLength),
      etag: cleanEtag(response.ETag),
      sha256: cleanSha256(response.Metadata?.sha256),
    };
  }

  async headObject(key: string): Promise<StoredObjectMetadata | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: safeContentLength(response.ContentLength),
        etag: cleanEtag(response.ETag),
        sha256: cleanSha256(response.Metadata?.sha256),
      };
    } catch (error) {
      const status =
        typeof error === "object" && error && "$metadata" in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
          : undefined;
      if (status === 404) return null;
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async listObjects(prefix: string): Promise<ObjectStorageEntry[]> {
    const entries: ObjectStorageEntry[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const item of response.Contents ?? []) {
        if (!item.Key) continue;
        entries.push({
          key: item.Key,
          size: safeContentLength(item.Size),
          etag: cleanEtag(item.ETag),
          // ListObjects does not return user metadata; reconciliation can use
          // HeadObject for records whose checksum must be compared.
          sha256: null,
          lastModified: item.LastModified,
        });
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return entries;
  }
}

let objectStorageOverride: ObjectStorage | undefined;
let objectStorageSingleton: ObjectStorage | undefined;

export function getObjectStorage(): ObjectStorage {
  if (objectStorageOverride) return objectStorageOverride;
  objectStorageSingleton ??= new S3ObjectStorage();
  return objectStorageSingleton;
}

/** Test-only dependency seam; production code never calls this. */
export function setObjectStorageForTests(storage?: ObjectStorage): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Object storage overrides are restricted to NODE_ENV=test.");
  }
  objectStorageOverride = storage;
  objectStorageSingleton = undefined;
}
