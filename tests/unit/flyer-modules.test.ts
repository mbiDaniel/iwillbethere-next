import { describe, it, expect } from "vitest";
import { createCanvas, canvasToBlob, canvasToBuffer } from "@/lib/flyer/canvas";
import {
  detectPlaceholders,
  sanitizeKey,
  inferPlaceholderType,
  carryOverOverrides,
} from "@/lib/flyer/detect";
import { calculateFit, applyImageFitAndMask } from "@/lib/flyer/fit";
import { fitTextToBox, wrapText, buildCanvasFont } from "@/lib/flyer/text";
import {
  validatePlaceholders,
  validateManifest,
  DEFAULT_VALIDATION_CONFIG,
} from "@/lib/flyer/validate";
import { flyerManifestSchema } from "@/lib/flyer/types";
import { flattenLayerTreeBottomToTop } from "@/lib/flyer/slice";

describe("lib/flyer/canvas", () => {
  it("creates a canvas with dimensions and context", () => {
    const canvas = createCanvas(200, 150);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(150);
    const ctx = canvas.getContext("2d");
    expect(ctx).toBeDefined();
  });

  it("converts canvas to Blob and Buffer", async () => {
    const canvas = createCanvas(50, 50);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "blue";
    ctx.fillRect(0, 0, 50, 50);

    const blob = await canvasToBlob(canvas, "image/png");
    expect(blob).toBeDefined();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("image/png");

    const buf = await canvasToBuffer(canvas, "image/png");
    expect(buf).toBeInstanceOf(Uint8Array);
    expect(buf.length).toBeGreaterThan(0);
  });
});

describe("lib/flyer/detect", () => {
  it("sanitizes keys properly", () => {
    expect(sanitizeKey("  guest_name<script> ")).toBe("guest_namescript");
    expect(sanitizeKey("photo...avatar")).toBe("photo.avatar");
    expect(sanitizeKey("my   long   name")).toBe("my long name");
  });

  it("infers placeholder types based on keywords", () => {
    expect(inferPlaceholderType("photo")).toBe("image");
    expect(inferPlaceholderType("avatar")).toBe("image");
    expect(inferPlaceholderType("guest_pic")).toBe("image");
    expect(inferPlaceholderType("sponsor_logo")).toBe("image");
    expect(inferPlaceholderType("name")).toBe("text");
    expect(inferPlaceholderType("ticket_number")).toBe("text");
  });

  it("detects placeholders recursively and skips hidden layers", () => {
    const mockPsd: any = {
      width: 1000,
      height: 1000,
      children: [
        {
          name: "#PLACEHOLDER_photo",
          left: 100,
          top: 100,
          right: 300,
          bottom: 300,
        },
        {
          name: "Group 1",
          children: [
            {
              name: "#PLACEHOLDER_name",
              left: 50,
              top: 500,
              right: 450,
              bottom: 560,
            },
            {
              name: "#PLACEHOLDER_hidden",
              hidden: true,
              left: 0,
              top: 0,
              right: 50,
              bottom: 50,
            },
          ],
        },
      ],
    };

    const detected = detectPlaceholders(mockPsd, "#PLACEHOLDER_");
    expect(detected.length).toBe(2);
    expect(detected[0].key).toBe("photo");
    expect(detected[0].type).toBe("image");
    expect(detected[0].box).toEqual({ x: 100, y: 100, w: 200, h: 200 });

    expect(detected[1].key).toBe("name");
    expect(detected[1].type).toBe("text");
    expect(detected[1].box).toEqual({ x: 50, y: 500, w: 400, h: 60 });
  });

  it("applies manual placeholder mappings to selected nested layers", () => {
    const mockPsd: any = {
      width: 400,
      height: 400,
      children: [
        {
          name: "Artwork",
          children: [
            {
              name: "Untitled layer",
              left: 30,
              top: 50,
              right: 230,
              bottom: 150,
            },
          ],
        },
      ],
    };

    const detected = detectPlaceholders(mockPsd, "#PLACEHOLDER_", {
      manualPlaceholders: [
        { layerPath: "0.0", key: "GUEST PHOTO", type: "image" },
      ],
    });

    expect(detected).toHaveLength(1);
    expect(detected[0].key).toBe("GUEST PHOTO");
    expect(detected[0].type).toBe("image");
    expect(detected[0].layerName).toBe("Untitled layer");
    expect(detected[0].box).toEqual({ x: 30, y: 50, w: 200, h: 100 });
  });

  it("turns manually selected layers into placeholder stream items", () => {
    const mockPsd: any = {
      width: 400,
      height: 400,
      children: [
        {
          name: "Artwork",
          children: [
            {
              name: "Layer 1",
              left: 30,
              top: 50,
              right: 230,
              bottom: 150,
            },
          ],
        },
      ],
    };

    const stream = flattenLayerTreeBottomToTop(
      mockPsd,
      "#PLACEHOLDER_",
      [],
      [{ layerPath: "0.0", key: "GUEST_NAME", type: "text" }]
    );

    expect(stream).toHaveLength(1);
    expect(stream[0].isPlaceholder).toBe(true);
    expect(stream[0].placeholder?.key).toBe("GUEST_NAME");
    expect(stream[0].placeholder?.type).toBe("text");
  });

  it("carries over existing designer overrides by matching key and type", () => {
    const detected: any[] = [
      {
        id: "1",
        key: "name",
        type: "text",
        options: { align: "left", maxLines: 1 },
      },
    ];

    const overrides: any[] = [
      {
        key: "name",
        type: "text",
        options: { align: "center", maxLines: 2, minFontSize: 16 },
        sampleValue: "Alex Morgan",
      },
    ];

    const carried = carryOverOverrides(detected, overrides);
    expect(carried[0].options.align).toBe("center");
    expect(carried[0].options.maxLines).toBe(2);
    expect(carried[0].options.sampleValue).toBe("Alex Morgan");
  });
});

describe("lib/flyer/fit", () => {
  it("calculates contain fit accurately", () => {
    // 200x100 container, 100x100 image
    const fit = calculateFit(200, 100, 100, 100, { fit: "contain" });
    expect(fit.dw).toBe(100);
    expect(fit.dh).toBe(100);
    expect(fit.dx).toBe(50); // centered horizontally
    expect(fit.dy).toBe(0);
  });

  it("calculates cover fit with center and focal point", () => {
    // 100x100 container, 200x100 image (wider)
    const fitCenter = calculateFit(100, 100, 200, 100, { fit: "cover", framingMode: "center" });
    expect(fitCenter.sw).toBe(100);
    expect(fitCenter.sh).toBe(100);
    expect(fitCenter.sx).toBe(50); // cropped from middle

    // Focal point towards the right (fx = 0.9)
    const fitFocal = calculateFit(100, 100, 200, 100, {
      fit: "cover",
      framingMode: "focal",
      focalPoint: { x: 0.9, y: 0.5 },
    });
    expect(fitFocal.sx).toBeGreaterThan(50);
  });

  it("applies fit and mask onto canvas", () => {
    const img = createCanvas(100, 100);
    const imgCtx = img.getContext("2d");
    imgCtx.fillStyle = "red";
    imgCtx.fillRect(0, 0, 100, 100);

    const mask = createCanvas(50, 50);
    const maskCtx = mask.getContext("2d");
    maskCtx.fillStyle = "white";
    maskCtx.beginPath();
    maskCtx.arc(25, 25, 20, 0, Math.PI * 2);
    maskCtx.fill();

    const output = applyImageFitAndMask(img, 50, 50, { fit: "cover" }, mask);
    expect(output.width).toBe(50);
    expect(output.height).toBe(50);
  });
});

describe("lib/flyer/text", () => {
  it("wraps text within bounds", () => {
    const canvas = createCanvas(300, 100);
    const ctx = canvas.getContext("2d");
    ctx.font = "16px sans-serif";

    const { lines, truncated } = wrapText(ctx, "Short text", 200, 1);
    expect(lines).toEqual(["Short text"]);
    expect(truncated).toBe(false);

    const longResult = wrapText(ctx, "This is a much longer line of text that should wrap", 100, 2);
    expect(longResult.lines.length).toBeLessThanOrEqual(2);
  });

  it("fits text to box by auto-shrinking", () => {
    const style = {
      fontFamily: "sans-serif",
      fontSize: 48,
      color: "#ffffff",
    };

    const layout = fitTextToBox("Very Long Guest Name That Needs To Fit Inside Box", 200, 40, style, {
      minFontSize: 12,
      maxFontSize: 48,
      maxLines: 1,
    });

    expect(layout.fontSize).toBeLessThanOrEqual(48);
    expect(layout.lines.length).toBe(1);
  });
});

describe("lib/flyer/validate", () => {
  it("flags zero placeholders as an error", () => {
    const issues = validatePlaceholders([]);
    expect(issues.some((i) => i.code === "ZERO_PLACEHOLDERS" && i.severity === "error")).toBe(true);
  });

  it("flags duplicate key conflict as an error", () => {
    const placeholders: any[] = [
      { key: "item", type: "text", layerName: "Text Layer" },
      { key: "item", type: "image", layerName: "Image Layer" },
    ];
    const issues = validatePlaceholders(placeholders);
    expect(issues.some((i) => i.code === "DUPLICATE_KEY_CONFLICT" && i.severity === "error")).toBe(true);
  });

  it("validates manifest against budget and slice counts", () => {
    const mockManifest: any = {
      version: 1,
      width: 1000,
      height: 1000,
      tiers: {
        preview: { scale: 0.5, width: 500, height: 500, totalBytes: 3.5 * 1024 * 1024 }, // over 2.5MB
        full: { scale: 1, width: 1000, height: 1000, totalBytes: 5 * 1024 * 1024 },
      },
      items: Array.from({ length: 15 }, (_, i) => ({
        kind: "slice",
        id: `s_${i}`,
        x: 0,
        y: 0,
        w: 500,
        h: 500,
        assets: {
          preview: { key: "k", url: "u", bytes: 100, sha256: "a".repeat(64), width: 500, height: 500, contentType: "image/png" },
          full: { key: "k", url: "u", bytes: 200, sha256: "b".repeat(64), width: 1000, height: 1000, contentType: "image/png" },
        },
      })),
      placeholders: [
        {
          id: "p1",
          key: "name",
          type: "text",
          layerName: "Name",
          box: { x: 10, y: 10, w: 200, h: 50 },
          options: {},
        },
      ],
      fonts: [{ family: "CustomFont", missing: true }],
      fidelity: { score: 0.75, method: "pixel-diff", warnings: [] },
      generator: { app: "I Will Be There", psdLayerCount: 10, createdAt: new Date().toISOString() },
    };

    const issues = validateManifest(mockManifest);
    expect(issues.some((i) => i.code === "SLICE_COUNT_HIGH" && i.severity === "warning")).toBe(true);
    expect(issues.some((i) => i.code === "OVER_BUDGET" && i.severity === "warning")).toBe(true);
    expect(issues.some((i) => i.code === "MISSING_FONTS" && i.severity === "warning")).toBe(true);
    expect(issues.some((i) => i.code === "LOW_FIDELITY" && i.severity === "warning")).toBe(true);
  });
});
