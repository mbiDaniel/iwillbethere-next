import { StorageService } from "./types";
import { env } from "@/lib/env";

export class MemoryStorageService implements StorageService {
  private store = new Map<string, { body: Buffer; contentType?: string; cacheControl?: string }>();
  private publicBaseUrl: string;

  constructor(publicBaseUrl: string = env.R2_PUBLIC_BASE_URL) {
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, "");
  }

  private getStoreKey(bucket: string, key: string): string {
    return `${bucket}:::${key}`;
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
    cacheControl?: string
  ): Promise<void> {
    const buf = Buffer.isBuffer(body)
      ? body
      : typeof body === "string"
        ? Buffer.from(body)
        : Buffer.from(body);
    this.store.set(this.getStoreKey(bucket, key), {
      body: buf,
      contentType,
      cacheControl,
    });
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const entry = this.store.get(this.getStoreKey(bucket, key));
    if (!entry) {
      throw new Error(`Object not found: ${bucket}/${key}`);
    }
    return entry.body;
  }

  async headObject(
    bucket: string,
    key: string
  ): Promise<{ contentLength: number; contentType?: string } | null> {
    const entry = this.store.get(this.getStoreKey(bucket, key));
    if (!entry) return null;
    return {
      contentLength: entry.body.length,
      contentType: entry.contentType,
    };
  }

  async getRange(
    bucket: string,
    key: string,
    start: number,
    end: number
  ): Promise<Buffer> {
    const buffer = await this.getObject(bucket, key);
    return buffer.subarray(start, end + 1);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    this.store.delete(this.getStoreKey(bucket, key));
  }

  async deletePrefix(bucket: string, prefix: string): Promise<void> {
    const prefixKey = `${bucket}:::${prefix}`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefixKey)) {
        this.store.delete(key);
      }
    }
  }

  async getSignedUploadUrl(
    bucket: string,
    key: string,
    _contentType: string,
    _maxSizeBytes?: number,
    _expiresInSeconds: number = 900
  ): Promise<string> {
    return `memory://${bucket}/${key}?signed=true`;
  }

  async getSignedDownloadUrl(
    bucket: string,
    key: string,
    _expiresInSeconds: number = 3600
  ): Promise<string> {
    return `memory://${bucket}/${key}?download=true`;
  }

  getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^\//, "");
    return `${this.publicBaseUrl}/${cleanKey}`;
  }

  clear() {
    this.store.clear();
  }
}
