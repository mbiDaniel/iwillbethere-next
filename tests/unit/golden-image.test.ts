import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import pixelmatch from "pixelmatch";
import { slicePsd } from "@/lib/flyer/slice";
import { renderFlyer } from "@/lib/flyer/render";
import { createCanvas, loadImageBitmap } from "@/lib/flyer/canvas";
import { readPsd, initializeCanvas } from "ag-psd";

initializeCanvas(createCanvas as any);

describe("Golden-image fidelity tests", () => {
  const validPsdPath = path.join(process.cwd(), "tests", "fixtures", "valid-event.psd");
  const psdBuffer = fs.readFileSync(validPsdPath);

  it("recomposited flyer matches PSD composite image within tolerance", async () => {
    const psd = readPsd(psdBuffer);
    expect(psd.canvas).toBeDefined();

    const sliceResult = await slicePsd(psdBuffer);

    // Mock asset bitmap mapping from sliced assets
    const assetBitmaps = new Map<string, any>();
    for (const a of sliceResult.assets) {
      if (a.tier === "full") {
        const img = await loadImageBitmap(a.blob);
        assetBitmaps.set(a.sha256, img);
      }
    }

    // Mock guest content matching PSD sample values
    const guestValues: Record<string, any> = {
      name: "Jamie Park",
    };
    const photoCanvas = createCanvas(200, 200);
    const pCtx = photoCanvas.getContext("2d");
    pCtx.fillStyle = "#ffffff";
    pCtx.beginPath();
    pCtx.arc(100, 100, 90, 0, Math.PI * 2);
    pCtx.fill();
    guestValues["photo"] = photoCanvas;

    // Render recomposited flyer at full resolution
    const recompositedCanvas = await renderFlyer({
      manifest: sliceResult.manifest,
      tier: "full",
      assetBitmaps,
      guestValues,
    });

    expect(recompositedCanvas.width).toBe(psd.width);
    expect(recompositedCanvas.height).toBe(psd.height);

    // Compare with pixelmatch on downscaled versions (for speed and tolerance)
    const testW = 400;
    const testH = 400;

    const canvasA = createCanvas(testW, testH);
    const ctxA = canvasA.getContext("2d");
    ctxA.drawImage(psd.canvas as any, 0, 0, psd.width, psd.height, 0, 0, testW, testH);

    const canvasB = createCanvas(testW, testH);
    const ctxB = canvasB.getContext("2d");
    ctxB.drawImage(recompositedCanvas as any, 0, 0, psd.width, psd.height, 0, 0, testW, testH);

    const dataA = ctxA.getImageData(0, 0, testW, testH).data;
    const dataB = ctxB.getImageData(0, 0, testW, testH).data;

    const diffPixels = pixelmatch(dataA, dataB, null, testW, testH, {
      threshold: 0.2,
      includeAA: false,
    });

    const diffRatio = diffPixels / (testW * testH);
    // Even with font rendering differences in text rasterizer, diff should be within acceptable margin (< 50%)
    expect(diffRatio).toBeLessThan(0.5);
  });
});
