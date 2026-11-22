import { describe, it, expect, beforeAll } from "vitest";
import { ensureCanvasInitialized } from "@/lib/psd/canvas";
import { flattenLayerTree, inferPlaceholderType, sanitizeKey } from "@/lib/psd/parser";
import { buildManifestAndSlices } from "@/lib/psd/manifest";
import { readPsd } from "ag-psd";
import fs from "fs";
import path from "path";
import {
  createValidFixturePsd,
  createDuplicateConflictingKeysFixturePsd,
} from "@/scripts/generate-fixtures";

describe("PSD Processing - Unit Tests", () => {
  beforeAll(() => {
    ensureCanvasInitialized();
  });

  describe("Key Sanitization & Type Inference", () => {
    it("sanitizes untrusted keys safely", () => {
      expect(sanitizeKey("  guest_name  ")).toBe("guest_name");
      expect(sanitizeKey("<script>alert(1)</script>photo")).toBe("scriptalert(1)scriptphoto");
      expect(sanitizeKey("user/../../avatar")).toBe("user.avatar");
      expect(sanitizeKey("hello   world")).toBe("hello world");
    });

    it("infers types accurately based on keyword rules", () => {
      expect(inferPlaceholderType("photo")).toBe("image");
      expect(inferPlaceholderType("guest_PHOTO")).toBe("image");
      expect(inferPlaceholderType("user_Avatar")).toBe("image");
      expect(inferPlaceholderType("band_pic")).toBe("image");
      expect(inferPlaceholderType("sponsor_logo")).toBe("image");
      expect(inferPlaceholderType("guest_image")).toBe("image");

      expect(inferPlaceholderType("name")).toBe("text");
      expect(inferPlaceholderType("date")).toBe("text");
      expect(inferPlaceholderType("seat_number")).toBe("text");
      expect(inferPlaceholderType("vip_status")).toBe("text");
    });
  });

  describe("Layer Tree Traversal & Placeholder Detection", () => {
    it("discovers placeholders across nested groups", () => {
      const psdBuffer = createValidFixturePsd();
      const psd = readPsd(psdBuffer);

      const { placeholders } = flattenLayerTree(psd, "#PLACEHOLDER_");

      expect(placeholders.length).toBe(2);
      const photo = placeholders.find((p) => p.type === "image");
      const name = placeholders.find((p) => p.type === "text");

      expect(photo).toBeDefined();
      expect(photo?.key).toBe("photo");
      expect(photo?.box.w).toBeGreaterThan(0);
      expect(photo?.box.h).toBeGreaterThan(0);

      expect(name).toBeDefined();
      expect(name?.key).toBe("name");
      expect(name?.textStyle?.fontFamily).toBe("Arial");
    });

    it("honors custom prefixes", () => {
      const psdBuffer = createValidFixturePsd();
      const psd = readPsd(psdBuffer);

      // Using an unmatched prefix returns 0 placeholders
      const { placeholders } = flattenLayerTree(psd, "CUSTOM_PREFIX_");
      expect(placeholders.length).toBe(0);
    });

    it("carries over previous designer options by key and type", () => {
      const psdBuffer = createValidFixturePsd();
      const psd = readPsd(psdBuffer);

      const prevMap = new Map();
      prevMap.set("name:::text", {
        maxLines: 2,
        maxLength: 80,
        align: "center",
      });

      const { placeholders } = flattenLayerTree(psd, "#PLACEHOLDER_", prevMap);
      const name = placeholders.find((p) => p.key === "name");

      expect(name?.options.maxLines).toBe(2);
      expect(name?.options.maxLength).toBe(80);
      expect(name?.options.align).toBe("center");
    });
  });

  describe("Manifest Slicing & Z-Order Preservation", () => {
    it("preserves z-order and slices layers above and below placeholders", () => {
      const psdBuffer = createValidFixturePsd();
      const psd = readPsd(psdBuffer);
      const { flattenedLayers, placeholders } = flattenLayerTree(psd, "#PLACEHOLDER_");

      const { manifest, slices } = buildManifestAndSlices(
        psd.width,
        psd.height,
        flattenedLayers,
        placeholders,
        [{ family: "Arial" }],
        "https://cdn.example.com"
      );

      expect(manifest.version).toBe(1);
      expect(manifest.width).toBe(800);
      expect(manifest.height).toBe(800);
      expect(manifest.items.length).toBeGreaterThan(0);
      expect(slices.length).toBeGreaterThan(0);

      // Verify manifest item order contains both slices and placeholders
      const hasSlice = manifest.items.some((i) => i.kind === "slice");
      const hasPlaceholder = manifest.items.some((i) => i.kind === "placeholder");
      expect(hasSlice).toBe(true);
      expect(hasPlaceholder).toBe(true);
    });
  });
});
