import { createCanvas } from "@napi-rs/canvas";
import type { FlattenedLayer } from "./parser";
import type {
  ExtractedPlaceholder,
  ManifestFont,
  ManifestItem,
  ManifestPlaceholder,
  RenderManifest,
} from "./types";

export interface SlicedManifestResult {
  manifest: RenderManifest;
  slices: { filename: string; buffer: Buffer; width: number; height: number }[];
  designerPreview: Buffer;
  cleanPreview: Buffer;
}

export function buildManifestAndSlices(
  psdWidth: number,
  psdHeight: number,
  flattenedLayers: FlattenedLayer[],
  placeholders: ExtractedPlaceholder[],
  availableFonts: { family: string; url?: string }[] = [],
  baseUrl: string = ""
): SlicedManifestResult {
  const slices: { filename: string; buffer: Buffer; width: number; height: number }[] = [];
  const items: ManifestItem[] = [];

  // Group consecutive non-placeholder layers into slices
  let currentSliceLayers: FlattenedLayer[] = [];
  let sliceIndex = 0;

  function flushSlice() {
    if (currentSliceLayers.length === 0) return;

    const sliceCanvas = createCanvas(psdWidth, psdHeight);
    const ctx = sliceCanvas.getContext("2d");

    for (const { layer } of currentSliceLayers) {
      if (layer.hidden) continue;

      ctx.save();
      if (typeof layer.opacity === "number") {
        ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      }

      if (layer.canvas) {
        const left = layer.left ?? 0;
        const top = layer.top ?? 0;
        ctx.drawImage(layer.canvas as any, left, top);
      }
      ctx.restore();
    }

    const filename = `slice_${sliceIndex++}.png`;
    const buffer = sliceCanvas.toBuffer("image/png");

    slices.push({
      filename,
      buffer,
      width: psdWidth,
      height: psdHeight,
    });

    items.push({
      kind: "slice",
      url: `${baseUrl}/${filename}`.replace(/\/+/g, "/"),
      width: psdWidth,
      height: psdHeight,
    });

    currentSliceLayers = [];
  }

  for (const item of flattenedLayers) {
    if (item.isPlaceholder && item.placeholder) {
      flushSlice();
      items.push({
        kind: "placeholder",
        placeholderId: item.placeholder.id,
      });
    } else {
      currentSliceLayers.push(item);
    }
  }
  flushSlice();

  // If there are no slices at all (e.g. only placeholders), create a transparent base slice
  if (slices.length === 0) {
    const emptyCanvas = createCanvas(psdWidth, psdHeight);
    const buffer = emptyCanvas.toBuffer("image/png");
    const filename = `slice_base.png`;
    slices.push({ filename, buffer, width: psdWidth, height: psdHeight });
    items.unshift({
      kind: "slice",
      url: `${baseUrl}/${filename}`.replace(/\/+/g, "/"),
      width: psdWidth,
      height: psdHeight,
    });
  }

  // Previews: max 1200px wide
  const maxPreviewWidth = 1200;
  const scale = psdWidth > maxPreviewWidth ? maxPreviewWidth / psdWidth : 1;
  const previewWidth = Math.round(psdWidth * scale);
  const previewHeight = Math.round(psdHeight * scale);

  // 1. Clean guest preview (draw only non-placeholder layers)
  const cleanCanvas = createCanvas(previewWidth, previewHeight);
  const cleanCtx = cleanCanvas.getContext("2d");
  cleanCtx.scale(scale, scale);

  for (const item of flattenedLayers) {
    if (item.isPlaceholder) continue;
    const { layer } = item;
    if (layer.hidden) continue;

    cleanCtx.save();
    if (typeof layer.opacity === "number") {
      cleanCtx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    }
    if (layer.canvas) {
      cleanCtx.drawImage(
        layer.canvas as any,
        layer.left ?? 0,
        layer.top ?? 0
      );
    }
    cleanCtx.restore();
  }
  const cleanPreview = cleanCanvas.toBuffer("image/png");

  // 2. Designer preview (includes samples and placeholder bounding outlines)
  const designerCanvas = createCanvas(previewWidth, previewHeight);
  const designerCtx = designerCanvas.getContext("2d");
  designerCtx.drawImage(cleanCanvas, 0, 0);

  designerCtx.scale(scale, scale);
  for (const p of placeholders) {
    const left = p.box.xPx ?? Math.round((p.box.x / 100) * psdWidth);
    const top = p.box.yPx ?? Math.round((p.box.y / 100) * psdHeight);
    const width = p.box.wPx ?? Math.round((p.box.w / 100) * psdWidth);
    const height = p.box.hPx ?? Math.round((p.box.h / 100) * psdHeight);

    designerCtx.save();
    designerCtx.strokeStyle = "rgba(0, 102, 255, 0.8)";
    designerCtx.lineWidth = 2 / scale;
    designerCtx.strokeRect(left, top, width, height);

    // Text sample or label
    designerCtx.fillStyle = "rgba(0, 102, 255, 0.15)";
    designerCtx.fillRect(left, top, width, height);

    designerCtx.fillStyle = "#0066ff";
    designerCtx.font = `bold ${Math.max(12, Math.round(14 / scale))}px sans-serif`;
    designerCtx.fillText(
      `[${p.type.toUpperCase()}] ${p.key}`,
      left + 4,
      Math.min(top + 16 / scale, top + height - 4)
    );
    designerCtx.restore();
  }
  const designerPreview = designerCanvas.toBuffer("image/png");

  // Format fonts used in manifest
  const fontsMap = new Map<string, ManifestFont>();
  for (const p of placeholders) {
    if (p.type === "text" && p.textStyle?.fontFamily) {
      const fam = p.textStyle.fontFamily;
      const matched = availableFonts.find(
        (f) => f.family.toLowerCase() === fam.toLowerCase()
      );
      fontsMap.set(fam, {
        family: fam,
        style: p.textStyle.fontStyle,
        missing: !matched,
        url: matched?.url,
      });
    }
  }

  const manifestPlaceholders: ManifestPlaceholder[] = placeholders.map((p) => ({
    id: p.id,
    key: p.key,
    type: p.type,
    box: p.box,
    options: p.options,
    textStyle: p.textStyle,
    maskUrl: p.maskKey
      ? `${baseUrl}/${p.maskKey}`.replace(/\/+/g, "/")
      : undefined,
    sampleValue: p.sampleValue,
  }));

  const manifest: RenderManifest = {
    version: 1,
    width: psdWidth,
    height: psdHeight,
    items,
    placeholders: manifestPlaceholders,
    fonts: Array.from(fontsMap.values()),
  };

  return {
    manifest,
    slices,
    designerPreview,
    cleanPreview,
  };
}
