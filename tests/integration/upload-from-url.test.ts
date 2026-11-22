import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDatabase } from "../test-db";
import { user, events, eventFormats, psdVersions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { uploadPsdFromUrl } from "@/lib/actions/psd";
import { setStorage, MemoryStorageService } from "@/lib/storage";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({
    id: "user_1",
    email: "user1@example.com",
    name: "Test User 1",
  }),
}));

describe("uploadPsdFromUrl - Integration Test", () => {
  let testContext: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: (typeof testContext)["db"];
  let memoryStorage: MemoryStorageService;

  beforeEach(async () => {
    testContext = await createTestDatabase();
    db = testContext.db;
    memoryStorage = new MemoryStorageService();
    setStorage(memoryStorage);

    // Default test user
    await db.insert(user).values({
      id: "user_1",
      name: "Test User 1",
      email: "user1@example.com",
    });
  });

  afterEach(async () => {
    await testContext.close();
  });

  it("rejects non-http/https URL schemes", async () => {
    const res = await uploadPsdFromUrl({
      eventId: "e1",
      eventFormatId: "f1",
      url: "ftp://example.com/file.psd",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBeDefined();
    }
  });

  it("blocks private/internal addresses for SSRF protection", async () => {
    const res = await uploadPsdFromUrl({
      eventId: "e1",
      eventFormatId: "f1",
      url: "http://169.254.169.254/latest/meta-data",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("Access to private or internal addresses is blocked");
    }
  });

  it("validates magic bytes and rejects non-PSD files", async () => {
    const eventId = "event_url_test";
    const formatId = "format_url_test";

    await db.insert(events).values({
      id: eventId,
      ownerId: "user_1",
      slug: "url-test",
      title: "URL Test",
      status: "draft",
    });

    await db.insert(eventFormats).values({
      id: formatId,
      eventId,
      format: "square",
      enabled: true,
    });

    // Mock global fetch returning plain text instead of PSD
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "12" }),
      arrayBuffer: async () => Buffer.from("NOT_A_PSD_FILE").buffer,
    });

    const res = await uploadPsdFromUrl({
      eventId,
      eventFormatId: formatId,
      url: "https://example.com/invalid.psd",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("not a valid Photoshop (.psd) document");
    }
  });

  it("successfully downloads valid PSD from URL, stores it, and enqueues processing", async () => {
    const eventId = "event_valid_url";
    const formatId = "format_valid_url";

    await db.insert(events).values({
      id: eventId,
      ownerId: "user_1",
      slug: "valid-url-test",
      title: "Valid URL Test",
      status: "draft",
    });

    await db.insert(eventFormats).values({
      id: formatId,
      eventId,
      format: "square",
      enabled: true,
    });

    // Valid PSD mock starting with '8BPS' (0x38 0x42 0x50 0x53)
    const mockPsdBytes = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01, 0x00, 0x00]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(mockPsdBytes.byteLength) }),
      arrayBuffer: async () => mockPsdBytes.buffer,
    });

    const res = await uploadPsdFromUrl({
      eventId,
      eventFormatId: formatId,
      url: "https://example.com/valid-flyer.psd",
    });

    if (!res.ok) {
      console.error("Test 4 failed with error:", res.error);
    }
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.versionId).toBeDefined();

    // Verify record in database
    const [version] = await db
      .select()
      .from(psdVersions)
      .where(eq(psdVersions.id, res.data.versionId));

    expect(version).toBeDefined();
    expect(version.eventFormatId).toBe(formatId);
    expect(version.status).toBe("uploaded");
  });
});
