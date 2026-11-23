import { createCanvas, canvasToBlob, CanvasInstance } from "./canvas";
import { applyImageFitAndMask } from "./fit";
import { loadFontsForManifest } from "./fonts";
import { fitTextToBox, renderFittedText } from "./text";
import { FlyerManifest, ManifestItem, ManifestPlaceholder, Tier } from "./types";

export interface RenderContext {
  manifest: FlyerManifest;
  tier: "preview" | "full";
  // Pre-loaded image assets mapped by asset key or URL
  assetBitmaps: Map<string, CanvasInstance | ImageBitmap | HTMLImageElement>;
  // User input values mapped by placeholderId or key
  guestValues: Record<string, string | CanvasInstance | ImageBitmap | HTMLImageElement | Blob>;
  // Options
  renderSamplesForEmpty?: boolean; // preview mode renders sampleValue; export doesn't unless filled
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  scale: number;
  resized: boolean;
}

export const IOS_CANVAS_PIXEL_LIMIT = 16_777_216; // 16.7 megapixels

/**
 * Renders the flyer at the specified tier onto a canvas.
 * Automatically loads any fonts declared in the manifest (Google Fonts or
 * custom-uploaded) before drawing text, so canvas ctx.font picks up the
 * correct typeface.
 */
export async function renderFlyer(
  context: RenderContext,
  targetCanvas?: CanvasInstance
): Promise<CanvasInstance> {
  const { manifest, tier: tierName, assetBitmaps, guestValues, renderSamplesForEmpty } = context;

  // Load fonts declared in the manifest before any text is drawn.
  // This is a no-op in Node/Worker environments where document.fonts is absent.
  await loadFontsForManifest(manifest);
  const tier = manifest.tiers[tierName];
  const scale = tier.scale;

  const canvas = targetCanvas || createCanvas(tier.width, tier.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire 2D context for canvas rendering");

  // Clear canvas
  ctx.clearRect(0, 0, tier.width, tier.height);

  const placeholderMap = new Map<string, ManifestPlaceholder>();
  for (const p of manifest.placeholders) {
    placeholderMap.set(p.id, p);
    placeholderMap.set(p.key, p);
  }

  // Draw items bottom-to-top
  for (const item of manifest.items) {
    if (item.kind === "slice") {
      const assetRef = item.assets[tierName];
      const sliceBitmap =
        assetBitmaps.get(assetRef.key) ||
        assetBitmaps.get(assetRef.url) ||
        assetBitmaps.get(assetRef.sha256);

      if (sliceBitmap) {
        const dx = Math.round(item.x * scale);
        const dy = Math.round(item.y * scale);
        const dw = Math.round(item.w * scale);
        const dh = Math.round(item.h * scale);

        ctx.drawImage(sliceBitmap as any, dx, dy, dw, dh);
      }
    } else if (item.kind === "placeholder") {
      const p = placeholderMap.get(item.placeholderId);
      if (!p) continue;

      const guestVal = guestValues[p.id] ?? guestValues[p.key];
      const valToUse = guestVal ?? (renderSamplesForEmpty ? p.options.sampleValue : undefined);
      if (!valToUse) continue;

      const boxX = Math.round(p.box.x * scale);
      const boxY = Math.round(p.box.y * scale);
      const boxW = Math.max(1, Math.round(p.box.w * scale));
      const boxH = Math.max(1, Math.round(p.box.h * scale));

      ctx.save();
      if (item.inheritedOpacity !== undefined && item.inheritedOpacity < 1) {
        ctx.globalAlpha = item.inheritedOpacity;
      }

      if (p.type === "text" && typeof valToUse === "string") {
        const baseStyle = p.textStyle || {
          fontFamily: "sans-serif",
          fontSize: 24,
          color: "#ffffff",
        };

        const guestTextScale = 1.2;
        const scaledStyle = {
          ...baseStyle,
          fontSize: Math.round(baseStyle.fontSize * guestTextScale * scale),
          lineHeight: baseStyle.lineHeight ? Math.round(baseStyle.lineHeight * scale) : undefined,
          tracking: baseStyle.tracking ? Math.round(baseStyle.tracking * scale) : undefined,
        };

        const layout = fitTextToBox(valToUse, boxW, boxH, scaledStyle, {
          maxLines: p.options.maxLines,
          maxLength: p.options.maxLength,
          align: p.options.align,
          minFontSize: p.options.minFontSize ? Math.round(p.options.minFontSize * scale) : undefined,
          maxFontSize: p.options.maxFontSize
            ? Math.round(p.options.maxFontSize * guestTextScale * scale)
            : undefined,
        });

        renderFittedText(ctx, layout, boxX, boxY, boxW, boxH, scaledStyle, {
          align: p.options.align,
        });
      } else if (p.type === "image") {
        // Image rendering
        let maskBitmap: any = null;
        if (p.options.useShapeAsMask && p.mask) {
          const maskRef = p.mask[tierName];
          maskBitmap =
            assetBitmaps.get(maskRef.key) ||
            assetBitmaps.get(maskRef.url) ||
            assetBitmaps.get(maskRef.sha256);
        }

        // valToUse can be a Canvas, ImageBitmap, or HTMLImageElement
        const imgObj = valToUse as any;
        if (imgObj && (imgObj.width || imgObj.naturalWidth)) {
          const iw = imgObj.width || imgObj.naturalWidth;
          const ih = imgObj.height || imgObj.naturalHeight;

          const fittedCanvas = applyImageFitAndMask(
            imgObj,
            boxW,
            boxH,
            {
              fit: p.options.fit,
              framingMode: p.options.framingMode,
              focalPoint: p.options.focalPoint,
            },
            maskBitmap
          );

          ctx.drawImage(fittedCanvas, boxX, boxY, boxW, boxH);
        }
      }

      ctx.restore();
    }
  }

  return canvas;
}

/**
 * Exports full resolution flyer with iOS canvas limits safety and auto-downscale fallback.
 */
export async function exportFlyer(
  context: Omit<RenderContext, "tier">,
  options: {
    format?: "image/png" | "image/jpeg";
    quality?: number;
    backgroundColor?: string; // for JPEG flattening
    maxExportPixels?: number;
  } = {}
): Promise<ExportResult> {
  const format = options.format ?? "image/png";
  const quality = options.quality ?? 0.92;
  const maxPixels = options.maxExportPixels ?? IOS_CANVAS_PIXEL_LIMIT;

  const manifest = context.manifest;
  const origW = manifest.width;
  const origH = manifest.height;

  let exportScale = 1.0;
  let exportW = origW;
  let exportH = origH;
  let resized = false;

  if (origW * origH > maxPixels) {
    exportScale = Math.sqrt(maxPixels / (origW * origH));
    exportW = Math.max(1, Math.round(origW * exportScale));
    exportH = Math.max(1, Math.round(origH * exportScale));
    resized = true;
  }

  // Helper with retry on canvas failure
  async function attemptRender(scaleFactor: number, w: number, h: number): Promise<CanvasInstance> {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");

    if (format === "image/jpeg") {
      // Fill background
      ctx.fillStyle = options.backgroundColor || "#ffffff";
      ctx.fillRect(0, 0, w, h);
    }

    // Adapt manifest tier scale to target export dimensions
    const adaptedManifest: FlyerManifest = {
      ...manifest,
      tiers: {
        ...manifest.tiers,
        full: {
          scale: scaleFactor,
          width: w,
          height: h,
          totalBytes: manifest.tiers.full.totalBytes,
        },
      },
    };

    return await renderFlyer(
      {
        ...context,
        manifest: adaptedManifest,
        tier: "full",
        renderSamplesForEmpty: false,
      },
      canvas
    );
  }

  let finalCanvas: CanvasInstance;
  try {
    finalCanvas = await attemptRender(exportScale, exportW, exportH);
  } catch {
    // If canvas allocation or render failed (e.g. mobile OOM), fallback to lower scale
    exportScale = exportScale * 0.75;
    exportW = Math.max(1, Math.round(origW * exportScale));
    exportH = Math.max(1, Math.round(origH * exportScale));
    resized = true;
    finalCanvas = await attemptRender(exportScale, exportW, exportH);
  }

  const blob = await canvasToBlob(finalCanvas, format, quality);
  return {
    blob,
    width: exportW,
    height: exportH,
    scale: exportScale,
    resized,
  };
}
