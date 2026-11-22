import fs from "fs";
import path from "path";
import { StorageService } from "./types";
import { env } from "@/lib/env";

export class LocalStorageService implements StorageService {
  private baseDir: string;
  private publicBaseUrl: string;

  constructor(
    baseDir: string = path.join(process.cwd(), ".uploads"),
    publicBaseUrl: string = env.R2_PUBLIC_BASE_URL || "/api/public/assets"
  ) {
    this.baseDir = baseDir;
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, "");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(bucket: string, key: string): string {
    const safeKey = key.replace(/\.\./g, "").replace(/^\/+/, "");
    return path.join(this.baseDir, bucket, safeKey);
  }

  private getMetaPath(bucket: string, key: string): string {
    return `${this.getFilePath(bucket, key)}.meta.json`;
  }

  async putObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
    cacheControl?: string
  ): Promise<void> {
    const filePath = this.getFilePath(bucket, key);
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    const buf = Buffer.isBuffer(body)
      ? body
      : typeof body === "string"
        ? Buffer.from(body)
        : Buffer.from(body);

    await fs.promises.writeFile(filePath, buf);

    if (contentType || cacheControl) {
      await fs.promises.writeFile(
        this.getMetaPath(bucket, key),
        JSON.stringify({ contentType, cacheControl })
      );
    }
  }

  async getObject(bucket: string, key: string): Promise<Buffer> {
    const filePath = this.getFilePath(bucket, key);
    try {
      return await fs.promises.readFile(filePath);
    } catch {
      throw new Error(`Local storage object not found: ${bucket}/${key}`);
    }
  }

  async headObject(
    bucket: string,
    key: string
  ): Promise<{ contentLength: number; contentType?: string } | null> {
    const filePath = this.getFilePath(bucket, key);
    try {
      const stat = await fs.promises.stat(filePath);
      let contentType: string | undefined;

      const metaPath = this.getMetaPath(bucket, key);
      try {
        const metaRaw = await fs.promises.readFile(metaPath, "utf-8");
        const meta = JSON.parse(metaRaw);
        contentType = meta.contentType;
      } catch {
        // Infer from extension
        if (key.endsWith(".png")) contentType = "image/png";
        else if (key.endsWith(".psd")) contentType = "image/vnd.adobe.photoshop";
        else if (key.endsWith(".json")) contentType = "application/json";
        else if (key.endsWith(".jpg") || key.endsWith(".jpeg"))
          contentType = "image/jpeg";
      }

      return {
        contentLength: stat.size,
        contentType,
      };
    } catch {
      return null;
    }
  }

  async getRange(
    bucket: string,
    key: string,
    start: number,
    end: number
  ): Promise<Buffer> {
    const filePath = this.getFilePath(bucket, key);
    const fd = await fs.promises.open(filePath, "r");
    try {
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);
      await fd.read(buffer, 0, length, start);
      return buffer;
    } finally {
      await fd.close();
    }
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const filePath = this.getFilePath(bucket, key);
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // Ignored if file does not exist
    }

    try {
      await fs.promises.unlink(this.getMetaPath(bucket, key));
    } catch {
      // Ignored
    }
  }

  async deletePrefix(bucket: string, prefix: string): Promise<void> {
    const prefixDir = this.getFilePath(bucket, prefix);
    try {
      await fs.promises.rm(prefixDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  }

  async getSignedUploadUrl(
    bucket: string,
    key: string,
    _contentType: string,
    _maxSizeBytes?: number,
    _expiresInSeconds: number = 900
  ): Promise<string> {
    return `/api/upload?key=${encodeURIComponent(key)}&bucket=${encodeURIComponent(bucket)}`;
  }

  async getSignedDownloadUrl(
    _bucket: string,
    key: string,
    _expiresInSeconds: number = 3600
  ): Promise<string> {
    return `/api/public/assets/${key.replace(/^\/+/, "")}`;
  }

  getPublicUrl(key: string): string {
    const cleanKey = key.replace(/^\/+/, "");
    return `/api/public/assets/${cleanKey}`;
  }
}
