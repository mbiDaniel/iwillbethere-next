import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { StorageService } from "./types";
import { env } from "@/lib/env";

export class R2StorageService implements StorageService {
  private client: S3Client;
  private publicBaseUrl: string;

  constructor() {
    this.publicBaseUrl = env.R2_PUBLIC_BASE_URL.replace(/\/$/, "");
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
    cacheControl?: string
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    });
    await this.client.send(command);
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`Object not found or empty: ${key}`);
    }
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async headObject(
    bucket: string,
    key: string
  ): Promise<{ contentLength: number; contentType?: string } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      const response = await this.client.send(command);
      return {
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType,
      };
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getRange(
    bucket: string,
    key: string,
    start: number,
    end: number
  ): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${start}-${end}`,
    });
    const response = await this.client.send(command);
    if (!response.Body) {
      throw new Error(`Range request failed for: ${key}`);
    }
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  async deletePrefix(bucket: string, prefix: string): Promise<void> {
    let continuationToken: string | undefined = undefined;
    while (true) {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const listResponse: ListObjectsV2CommandOutput = await this.client.send(listCommand);
      if (listResponse.Contents && listResponse.Contents.length > 0) {
        const toDelete = listResponse.Contents
          .map((obj) => obj.Key)
          .filter((k): k is string => typeof k === "string")
          .map((Key) => ({ Key }));
        if (toDelete.length > 0) {
          const deleteCommand = new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: toDelete },
          });
          await this.client.send(deleteCommand);
        }
      }
      if (!listResponse.IsTruncated || !listResponse.NextContinuationToken) {
        break;
      }
      continuationToken = listResponse.NextContinuationToken;
    }
  }

  async getSignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    _maxSizeBytes?: number,
    expiresInSeconds: number = 900
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });
    return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async getSignedDownloadUrl(
    bucket: string,
    key: string,
    expiresInSeconds: number = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^\//, "");
    return `${this.publicBaseUrl}/${cleanKey}`;
  }
}
