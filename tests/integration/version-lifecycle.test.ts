import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDatabase } from "../test-db";
import { user, events, eventFormats, psdVersions, placeholders, validationIssues } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  createVersion,
  createAssetUploadUrls,
  commitVersion,
  publishEvent,
  restoreVersion,
  getRescanSignedUrl,
} from "@/lib/actions/psd";
import { setStorage, MemoryStorageService } from "@/lib/storage";
import { FlyerManifest } from "@/lib/flyer/types";
import { env } from "@/lib/env";

let currentTestUserId = "user_1";
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockImplementation(() => Promise.resolve({
    id: currentTestUserId,
    email: `${currentTestUserId}@example.com`,
    name: "Test Designer",
  })),
}));

describe("Version Lifecycle & Commit Integration Tests", () => {
  let testContext: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: (typeof testContext)["db"];
  let memoryStorage: MemoryStorageService;

  const eventId = "event_test_lifecycle";
  const formatId = "format_test_lifecycle";

  beforeEach(async () => {
    currentTestUserId = "user_1";
    testContext = await createTestDatabase();
    db = testContext.db;
    memoryStorage = new MemoryStorageService("http://localhost:3000/api/public/assets");
    setStorage(memoryStorage);

    // Create user_1 and user_2
    await db.insert(user).values([
      { id: "user_1", name: "Designer One", email: "one@example.com" },
      { id: "user_2", name: "Designer Two", email: "two@example.com" },
    ]);

    // Create event owned by user_1
    await db.insert(events).values({
      id: eventId,
      ownerId: "user_1",
      slug: "designer-night",
      title: "Designer Night",
      status: "draft",
    });

    await db.insert(eventFormats).values({
      id: formatId,
      eventId,
      format: "square",
      enabled: true,
    });
  });

  afterEach(async () => {
    await testContext.close();
  });

  function createValidManifest(verId: string, overrides: Partial<FlyerManifest> = {}): FlyerManifest {
    const versionPrefix = `events/${eventId}/versions/${verId}/`;
    const sliceSha = "a".repeat(64);
    const prevSha = "b".repeat(64);

    return {
      version: 1,
      width: 1000,
      height: 1000,
      tiers: {
        preview: { scale: 0.5, width: 500, height: 500, totalBytes: 50000 },
        full: { scale: 1, width: 1000, height: 1000, totalBytes: 200000 },
      },
      items: [
        {
          kind: "slice",
          id: "slice_1",
          x: 0,
          y: 0,
          w: 1000,
          h: 1000,
          assets: {
            preview: {
              key: `${versionPrefix}slices/${prevSha}.png`,
              url: `/api/public/assets/${versionPrefix}slices/${prevSha}.png`,
              bytes: 50000,
              sha256: prevSha,
              width: 500,
              height: 500,
              contentType: "image/png",
            },
            full: {
              key: `${versionPrefix}slices/${sliceSha}.png`,
              url: `/api/public/assets/${versionPrefix}slices/${sliceSha}.png`,
              bytes: 200000,
              sha256: sliceSha,
              width: 1000,
              height: 1000,
              contentType: "image/png",
            },
          },
        },
        {
          kind: "placeholder",
          placeholderId: "p_name",
        },
      ],
      placeholders: [
        {
          id: "p_name",
          key: "name",
          type: "text",
          layerName: "#PLACEHOLDER_name",
          box: { x: 100, y: 700, w: 800, h: 100 },
          options: { align: "center", maxLines: 1 },
          textStyle: { fontFamily: "Arial", fontSize: 32, color: "#ffffff" },
        },
      ],
      fonts: [],
      generator: {
        app: "I Will Be There",
        psdLayerCount: 3,
        createdAt: new Date().toISOString(),
      },
      ...overrides,
    };
  }

  // PNG header bytes (89 50 4E 47 0D 0A 1A 0A)
  const validPngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  it("enforces ownership: second user cannot create version or commit for another user's event", async () => {
    currentTestUserId = "user_2"; // Impersonate user_2

    const createRes = await createVersion({ eventId, formatId });
    expect(createRes.ok).toBe(false);
    if (!createRes.ok) {
      expect(createRes.error).toContain("Forbidden");
    }
  });

  it("handles complete version lifecycle: create, generate upload urls, upload, commit, publish", async () => {
    // 1. Create version
    const createRes = await createVersion({ eventId, formatId });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;

    const versionId = createRes.data.versionId;
    expect(createRes.data.versionNumber).toBe(1);

    // 2. Request asset upload URLs
    const sliceSha = "a".repeat(64);
    const prevSha = "b".repeat(64);
    const assetUrlRes = await createAssetUploadUrls({
      versionId,
      assets: [
        { kind: "slice", tier: "preview", sha256: prevSha, bytes: 50000, contentType: "image/png" },
        { kind: "slice", tier: "full", sha256: sliceSha, bytes: 200000, contentType: "image/png" },
      ],
    });

    expect(assetUrlRes.ok).toBe(true);
    if (!assetUrlRes.ok) return;

    expect(assetUrlRes.data.uploadUrls.length).toBe(2);
    const previewAsset = assetUrlRes.data.uploadUrls.find((u) => u.tier === "preview");
    const fullAsset = assetUrlRes.data.uploadUrls.find((u) => u.tier === "full");
    expect(previewAsset?.key).toContain(`versions/${versionId}/slices/${prevSha}.png`);

    // Put valid PNG data into memory storage simulating client upload
    const prevBuffer = Buffer.concat([validPngHeader, Buffer.alloc(50000 - validPngHeader.length)]);
    const fullBuffer = Buffer.concat([validPngHeader, Buffer.alloc(200000 - validPngHeader.length)]);
    await memoryStorage.putObject(env.R2_BUCKET_PUBLIC, previewAsset!.key, prevBuffer, "image/png");
    await memoryStorage.putObject(env.R2_BUCKET_PUBLIC, fullAsset!.key, fullBuffer, "image/png");

    // 3. Commit version
    const manifest = createValidManifest(versionId);
    const commitRes = await commitVersion({
      versionId,
      manifest,
    });

    expect(commitRes.ok).toBe(true);
    if (!commitRes.ok) return;

    expect(commitRes.data.status).toBe("ready");
    expect(commitRes.data.manifestUrl).toBeDefined();

    // Verify DB state
    const [verRow] = await db.select().from(psdVersions).where(eq(psdVersions.id, versionId));
    expect(verRow.status).toBe("ready");
    expect(verRow.sliceCount).toBe(1);
    expect(verRow.totalPreviewBytes).toBe(50000);

    // Verify placeholders written
    const dbPls = await db.select().from(placeholders).where(eq(placeholders.psdVersionId, versionId));
    expect(dbPls.length).toBe(1);
    expect(dbPls[0].key).toBe("name");

    // 4. Publish event
    const pubRes = await publishEvent(eventId);
    expect(pubRes.ok).toBe(true);

    const [fmtRow] = await db.select().from(eventFormats).where(eq(eventFormats.id, formatId));
    expect(fmtRow.publishedVersionId).toBe(versionId);

    const [eventRow] = await db.select().from(events).where(eq(events.id, eventId));
    expect(eventRow.status).toBe("published");
  });

  it("commitVersion rejects bad prefix, missing asset, wrong size, or oversized manifest", async () => {
    const createRes = await createVersion({ eventId, formatId });
    if (!createRes.ok) return;
    const versionId = createRes.data.versionId;

    // A: Bad prefix
    const badPrefixManifest = createValidManifest(versionId);
    (badPrefixManifest.items[0] as any).assets.preview.key = "events/other_event/versions/other/slice.png";
    const resA = await commitVersion({ versionId, manifest: badPrefixManifest });
    expect(resA.ok).toBe(false);
    if (!resA.ok) {
      expect(resA.error).toContain("does not match version prefix");
    }

    // B: Missing asset from storage
    const missingAssetManifest = createValidManifest(versionId);
    const resB = await commitVersion({ versionId, manifest: missingAssetManifest });
    expect(resB.ok).toBe(false);
    if (!resB.ok) {
      expect(resB.error).toContain("was not found in storage");
    }

    // C: Oversized manifest JSON (> 100KB)
    const giantManifest = createValidManifest(versionId, {
      fonts: Array.from({ length: 2500 }, (_, i) => ({
        family: `VeryLongFontFamilyNameStringRepeatedManyTimes_${i}_${"x".repeat(50)}`,
        missing: false,
      })),
    });
    const resC = await commitVersion({ versionId, manifest: giantManifest });
    expect(resC.ok).toBe(false);
    if (!resC.ok) {
      expect(resC.error).toContain("Manifest JSON exceeds maximum size limit");
    }
  });

  it("allows restoring an earlier ready version", async () => {
    // Create version 1
    const v1Res = await createVersion({ eventId, formatId });
    if (!v1Res.ok) return;
    const v1Id = v1Res.data.versionId;
    await db.update(psdVersions).set({ status: "ready" }).where(eq(psdVersions.id, v1Id));

    // Create version 2
    const v2Res = await createVersion({ eventId, formatId });
    if (!v2Res.ok) return;
    const v2Id = v2Res.data.versionId;
    await db.update(psdVersions).set({ status: "ready" }).where(eq(psdVersions.id, v2Id));

    // Publish v2
    await db.update(eventFormats).set({ publishedVersionId: v2Id }).where(eq(eventFormats.id, formatId));

    // Restore v1
    const restoreRes = await restoreVersion({ eventId, formatId, versionId: v1Id });
    expect(restoreRes.ok).toBe(true);

    const [fmt] = await db.select().from(eventFormats).where(eq(eventFormats.id, formatId));
    expect(fmt.publishedVersionId).toBe(v1Id);
  });
});
