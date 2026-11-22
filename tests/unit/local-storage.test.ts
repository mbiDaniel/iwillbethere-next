import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LocalStorageService } from "@/lib/storage/local";
import { getStorageDriver } from "@/lib/storage";
import fs from "fs";
import path from "path";

describe("Storage driver selection", () => {
  it("uses local disk in development and R2 only in production", () => {
    expect(getStorageDriver("development")).toBe("local");
    expect(getStorageDriver("production")).toBe("r2");
    expect(getStorageDriver("production", true)).toBe("r2");
  });

  it("uses memory storage for tests and explicit memory mode", () => {
    expect(getStorageDriver("test")).toBe("memory");
    expect(getStorageDriver("development", true)).toBe("memory");
  });
});

describe("LocalStorageService", () => {
  const testDir = path.join(process.cwd(), ".uploads_test");
  let storage: LocalStorageService;

  beforeEach(() => {
    storage = new LocalStorageService(testDir);
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it("puts and gets an object locally", async () => {
    const bucket = "test-bucket";
    const key = "folder/sample.txt";
    const content = Buffer.from("Hello Local Storage");

    await storage.putObject(bucket, key, content, "text/plain");

    const retrieved = await storage.getObject(bucket, key);
    expect(retrieved.toString()).toBe("Hello Local Storage");

    const head = await storage.headObject(bucket, key);
    expect(head?.contentLength).toBe(content.length);
    expect(head?.contentType).toBe("text/plain");
  });

  it("reads range slices accurately from local files", async () => {
    const bucket = "test-bucket";
    const key = "range.bin";
    const data = Buffer.from("0123456789ABCDEF");

    await storage.putObject(bucket, key, data);

    const range = await storage.getRange(bucket, key, 4, 9);
    expect(range.toString()).toBe("456789");
  });

  it("deletes objects and prefixes cleanly", async () => {
    const bucket = "test-bucket";
    await storage.putObject(bucket, "events/e1/file1.png", Buffer.from("img1"));
    await storage.putObject(bucket, "events/e1/file2.png", Buffer.from("img2"));

    await storage.deleteObject(bucket, "events/e1/file1.png");
    const head1 = await storage.headObject(bucket, "events/e1/file1.png");
    expect(head1).toBeNull();

    await storage.deletePrefix(bucket, "events/e1");
    const head2 = await storage.headObject(bucket, "events/e1/file2.png");
    expect(head2).toBeNull();
  });

  it("generates local signed upload URL directly pointing to /api/upload", async () => {
    const url = await storage.getSignedUploadUrl("private", "events/123/test.psd", "image/vnd.adobe.photoshop");
    expect(url).toContain("/api/upload?key=events%2F123%2Ftest.psd&bucket=private");
  });
});
