import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  createFlattenedFallback,
  inspectPsdLayers,
  preflightCheck,
  slicePsd,
  trimCanvas,
} from "@/lib/flyer/slice";
import { renderFlyer, exportFlyer } from "@/lib/flyer/render";
import { flyerManifestSchema } from "@/lib/flyer/types";
import { createCanvas } from "@/lib/flyer/canvas";

describe("lib/flyer/slice & render integration", () => {
  const validPsdPath = path.join(process.cwd(), "tests", "fixtures", "valid-event.psd");
  const validPsdBuffer = fs.readFileSync(validPsdPath);

  it("preflightCheck accepts valid PSD and rejects PSB / invalid bytes", () => {
    expect(() => preflightCheck(validPsdBuffer)).not.toThrow();

    // Invalid magic bytes
    const invalidBytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
    expect(() => preflightCheck(invalidBytes)).toThrow("File is too small");

    const badMagic = new Uint8Array(30);
    badMagic.set([0x58, 0x58, 0x58, 0x58]);
    expect(() => preflightCheck(badMagic)).toThrow("missing 8BPS signature");

    // PSB file (version = 2)
    const psbBytes = new Uint8Array(validPsdBuffer);
    psbBytes[4] = 0;
    psbBytes[5] = 2;
    expect(() => preflightCheck(psbBytes)).toThrow("Photoshop Big (.psb) format is not supported");
  });

  it("trims canvas accurately to non-transparent bounding box", () => {
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext("2d");
    // Draw 50x50 red square at (50, 40)
    ctx.fillStyle = "rgba(255, 0, 0, 1)";
    ctx.fillRect(50, 40, 50, 50);

    const trimmed = trimCanvas(canvas);
    expect(trimmed.canvas).not.toBeNull();
    expect(trimmed.x).toBe(50);
    expect(trimmed.y).toBe(40);
    expect(trimmed.w).toBe(50);
    expect(trimmed.h).toBe(50);

    // Empty transparent canvas
    const emptyCanvas = createCanvas(100, 100);
    const emptyTrimmed = trimCanvas(emptyCanvas);
    expect(emptyTrimmed.canvas).toBeNull();
  });

  it("slices valid-event.psd into z-ordered slices and placeholders", async () => {
    const result = await slicePsd(validPsdBuffer);

    // Validate manifest against Zod schema
    const parsed = flyerManifestSchema.safeParse(result.manifest);
    expect(parsed.success).toBe(true);

    expect(result.manifest.width).toBe(800);
    expect(result.manifest.height).toBe(800);
    expect(result.manifest.placeholders.length).toBe(2);

    const photoPl = result.manifest.placeholders.find((p) => p.key === "photo");
    expect(photoPl).toBeDefined();
    expect(photoPl?.type).toBe("image");

    const namePl = result.manifest.placeholders.find((p) => p.key === "name");
    expect(namePl).toBeDefined();
    expect(namePl?.type).toBe("text");

    // Verify z-order:
    // PSD has: Top: "Decorative Border", Middle: placeholders, Bottom: "Background"
    // Bottom-to-top draw order in items:
    // slice(s) containing background -> placeholders -> slice containing Decorative Border on top!
    const items = result.manifest.items;
    expect(items.length).toBeGreaterThanOrEqual(3);

    // First item should be a slice (Background)
    expect(items[0].kind).toBe("slice");
    // Middle items include placeholders
    const placeholderItems = items.filter((i) => i.kind === "placeholder");
    expect(placeholderItems.length).toBe(2);
    // Last item should be a slice (Decorative Border on top)
    expect(items[items.length - 1].kind).toBe("slice");

    // Assets generated for preview and full
    expect(result.assets.length).toBeGreaterThan(0);
    for (const asset of result.assets) {
      expect(["slice", "mask"]).toContain(asset.kind);
      expect(["preview", "full"]).toContain(asset.tier);
      expect(asset.sha256).toHaveLength(64);
      expect(asset.bytes).toBeGreaterThan(0);
    }
  });

  it("lets users map layers manually when a PSD has no placeholder tags", async () => {
    const noPlaceholderPath = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "zero-placeholders.psd"
    );
    const noPlaceholderBuffer = fs.readFileSync(noPlaceholderPath);
    const layers = inspectPsdLayers(noPlaceholderBuffer);

    expect(layers.length).toBeGreaterThan(0);
    expect(layers.some((layer) => layer.hasPlaceholderTag)).toBe(false);

    const result = await slicePsd(noPlaceholderBuffer, {
      manualPlaceholders: [
        {
          layerPath: layers[0].layerPath,
          key: "GUEST_NAME",
          type: "text",
        },
      ],
    });

    expect(result.manifest.placeholders).toHaveLength(1);
    expect(result.manifest.placeholders[0].key).toBe("GUEST_NAME");
    expect(result.validationIssues.some((issue) => issue.code === "ZERO_PLACEHOLDERS")).toBe(false);
  });

  it("renders guest flyer from sliced manifest and exported output", async () => {
    const result = await slicePsd(validPsdBuffer);

    // Prepare simulated preloaded asset bitmaps
    const assetBitmaps = new Map<string, any>();
    for (const asset of result.assets) {
      const c = createCanvas(asset.width, asset.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = asset.kind === "mask" ? "#ffffff" : "#ff00ff";
      ctx.fillRect(0, 0, asset.width, asset.height);
      assetBitmaps.set(asset.sha256, c);
    }

    // Guest values
    const guestPhoto = createCanvas(300, 300);
    const photoCtx = guestPhoto.getContext("2d");
    photoCtx.fillStyle = "blue";
    photoCtx.fillRect(0, 0, 300, 300);

    const previewCanvas = await renderFlyer({
      manifest: result.manifest,
      tier: "preview",
      assetBitmaps,
      guestValues: {
        photo: guestPhoto,
        name: "Samantha Doe",
      },
    });

    expect(previewCanvas).toBeDefined();
    expect(previewCanvas.width).toBe(result.manifest.tiers.preview.width);
    expect(previewCanvas.height).toBe(result.manifest.tiers.preview.height);

    // Export test
    const exportResult = await exportFlyer(
      {
        manifest: result.manifest,
        assetBitmaps,
        guestValues: {
          photo: guestPhoto,
          name: "Samantha Doe",
        },
      },
      { format: "image/png" }
    );

    expect(exportResult.blob).toBeDefined();
    expect(exportResult.blob.type).toBe("image/png");
    expect(exportResult.width).toBe(800);
    expect(exportResult.height).toBe(800);
  });

  it("reduces guest text size when a guest scale is applied", async () => {
    const manifest: any = {
      width: 200,
      height: 80,
      tiers: {
        preview: { scale: 1, width: 200, height: 80, totalBytes: 0 },
        full: { scale: 1, width: 200, height: 80, totalBytes: 0 },
      },
      items: [{ kind: "placeholder", placeholderId: "name" }],
      placeholders: [
        {
          id: "name",
          key: "NAME",
          type: "text",
          layerName: "NAME",
          box: { x: 0, y: 0, w: 200, h: 80 },
          options: { fontSize: 40, maxLines: 1 },
          textStyle: { fontFamily: "sans-serif", fontSize: 40, color: "#ffffff" },
        },
      ],
      fonts: [],
      generator: { app: "test", psdLayerCount: 1, createdAt: new Date().toISOString() },
    };
    const context = {
      manifest,
      tier: "preview" as const,
      assetBitmaps: new Map<string, any>(),
      guestValues: { name: "DANIEL" },
    };
    const fullSize = await renderFlyer(context);
    const reducedSize = await renderFlyer({
      ...context,
      guestTextScales: { name: 0.5 },
    });
    const countPaintedPixels = (canvas: ReturnType<typeof createCanvas>) => {
      const { data } = canvas.getContext("2d").getImageData(0, 0, 200, 80);
      let count = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) count += 1;
      }
      return count;
    };

    expect(countPaintedPixels(reducedSize)).toBeLessThan(countPaintedPixels(fullSize));
  });

  it("handles flattened fallback composite properly", async () => {
    const sliceResult = await slicePsd(validPsdBuffer);
    const fallback = await createFlattenedFallback(
      validPsdBuffer,
      sliceResult.manifest.placeholders
    );

    expect(fallback.manifest.items.length).toBe(1 + sliceResult.manifest.placeholders.length);
    expect(fallback.manifest.items[0].kind).toBe("slice");
    expect(fallback.assets.length).toBe(2); // 1 preview, 1 full
  });
});
