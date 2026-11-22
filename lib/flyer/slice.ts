import { readPsd, initializeCanvas, Layer, Psd } from "ag-psd";
import pixelmatch from "pixelmatch";
import { createCanvas, canvasToBlob, loadImageBitmap, CanvasInstance } from "./canvas";
import {
  AssetRef,
  FlyerManifest,
  ManifestFont,
  ManifestItem,
  ManifestPlaceholder,
  PlaceholderTextStyle,
  SlicedAsset,
  SlicerResult,
  Tier,
} from "./types";
import { DetectedPlaceholder, detectPlaceholders, sanitizeKey, inferPlaceholderType } from "./detect";
import { ValidationIssue } from "./validate";
import { applyImageFitAndMask } from "./fit";
import { fitTextToBox, renderFittedText } from "./text";

export type { SlicerResult, SlicedAsset } from "./types";

// Ensure ag-psd is initialized with our canvas factory
initializeCanvas(createCanvas as any);

export interface SliceOptions {
  prefix?: string;
  caseSensitive?: boolean;
  budgetPreviewBytes?: number; // default 2.5MB
  fidelityThreshold?: number; // default 0.85
  maxCanvasPixels?: number; // default 100_000_000 (100 MP)
  maxCanvasSide?: number; // default 10,000 px
  maxFileSizeBytes?: number; // default 100 MB
  designerOverrides?: Array<{
    key: string;
    type: "text" | "image";
    options: any;
    sampleValue?: string;
  }>;
  onProgress?: (step: "reading" | "parsing" | "detecting" | "slicing" | "encoding" | "verifying", percent: number) => void;
}

export const SUPPORTED_BLEND_MODES: Record<string, GlobalCompositeOperation> = {
  normal: "source-over",
  "pass through": "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color-dodge": "color-dodge",
  "color burn": "color-burn",
  "color-burn": "color-burn",
  "hard light": "hard-light",
  "hard-light": "hard-light",
  "soft light": "soft-light",
  "soft-light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
};

/**
 * Computes SHA-256 hash string of a Blob or Uint8Array.
 */
export async function computeSha256(data: Blob | Uint8Array | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Pre-flight verification of PSD binary data.
 */
export function preflightCheck(
  buffer: ArrayBuffer | Uint8Array,
  options?: { maxSizeBytes?: number }
): void {
  const maxBytes = options?.maxSizeBytes ?? 100 * 1024 * 1024;
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      `PSD file is too large (${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is ${(maxBytes / (1024 * 1024)).toFixed(0)} MB.`
    );
  }

  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 26) {
    throw new Error("File is too small to be a valid Adobe Photoshop document.");
  }

  // Magic bytes: 8BPS (0x38, 0x42, 0x50, 0x53)
  if (
    bytes[0] !== 0x38 ||
    bytes[1] !== 0x42 ||
    bytes[2] !== 0x50 ||
    bytes[3] !== 0x53
  ) {
    throw new Error("Invalid Photoshop file: missing 8BPS signature.");
  }

  // Version check (bytes 4-5): 1 for PSD, 2 for PSB
  const version = (bytes[4] << 8) | bytes[5];
  if (version === 2) {
    throw new Error("Photoshop Big (.psb) format is not supported. Please save as standard .psd.");
  }
  if (version !== 1) {
    throw new Error(`Unsupported Photoshop version (${version}).`);
  }
}

/**
 * Trims a canvas to its non-transparent pixel bounds.
 */
export function trimCanvas(canvas: CanvasInstance): {
  x: number;
  y: number;
  w: number;
  h: number;
  canvas: CanvasInstance | null;
} {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { x: 0, y: 0, w: 0, h: 0, canvas: null };

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const alpha = data[rowOffset + x * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, w: 0, h: 0, canvas: null };
  }

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  const trimmed = createCanvas(w, h);
  const trimCtx = trimmed.getContext("2d");
  trimCtx.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);

  return { x: minX, y: minY, w, h, canvas: trimmed };
}

/**
 * Extracts text style from a PSD text layer.
 */
export function extractTextStyle(layer: Layer): PlaceholderTextStyle | undefined {
  if (!layer.text) return undefined;

  const style = layer.text.style || (layer.text.styleRuns && layer.text.styleRuns[0]?.style);
  const paragraph =
    layer.text.paragraphStyle ||
    (layer.text.paragraphStyleRuns && layer.text.paragraphStyleRuns[0]?.style);

  let color = "#ffffff";
  if (style?.fillColor) {
    const c = style.fillColor as { r?: number; g?: number; b?: number };
    const r = Math.round(c.r ?? 255);
    const g = Math.round(c.g ?? 255);
    const b = Math.round(c.b ?? 255);
    color = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  let align: "left" | "center" | "right" = "left";
  if (paragraph?.justification) {
    const just = String(paragraph.justification).toLowerCase();
    if (just.includes("center")) align = "center";
    else if (just.includes("right")) align = "right";
  }

  const family = style?.font?.name || "sans-serif";
  const fontSize = style?.fontSize ? Math.round(style.fontSize) : 24;

  return {
    fontFamily: family,
    fontStyle: (style?.font as any)?.style || "normal",
    fontSize,
    color,
    lineHeight: style?.leading ? Math.round(style.leading) : undefined,
    tracking: style?.tracking ? Math.round(style.tracking) : undefined,
    direction: "ltr",
  };
}

/**
 * Extracts alpha mask for an image placeholder layer.
 */
export function extractAlphaMaskCanvas(layer: Layer, boxW: number, boxH: number): CanvasInstance | null {
  const w = Math.max(1, Math.round(boxW));
  const h = Math.max(1, Math.round(boxH));

  if (layer.canvas) {
    const maskCanvas = createCanvas(w, h);
    const ctx = maskCanvas.getContext("2d");
    ctx.drawImage(layer.canvas as any, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        hasAlpha = true;
        break;
      }
    }

    if (hasAlpha) {
      return maskCanvas;
    }
  }

  return null;
}

export interface FlattenedStreamItem {
  isPlaceholder: boolean;
  placeholder?: DetectedPlaceholder;
  layer?: Layer;
  canvas?: CanvasInstance;
  opacity: number;
  blendMode: string;
  inheritedOpacity?: number;
}

/**
 * Flattens the PSD layer tree bottom-to-top into an ordered stream.
 */
export function flattenLayerTreeBottomToTop(
  psd: Psd,
  prefix: string,
  issues: ValidationIssue[]
): FlattenedStreamItem[] {
  const stream: FlattenedStreamItem[] = [];

  function processLayers(
    layers: Layer[] | undefined,
    parentPath: string[],
    parentOpacity: number,
    parentGroup?: Layer
  ) {
    if (!layers || !Array.isArray(layers)) return;

    // In PSD / ag-psd, children are stored top-to-bottom.
    // Bottom-to-top means traversing in reverse: from length - 1 down to 0.
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (layer.hidden) continue;

      const layerOpacity = (layer.opacity ?? 1) * parentOpacity;
      const layerName = layer.name ?? "";
      const isPlaceholder = layerName.startsWith(prefix);

      // Check layer effects
      const effects = (layer as any).effects;
      if (effects) {
        const activeEffects: string[] = [];
        if (effects.dropShadow?.some((e: any) => e.enabled !== false)) activeEffects.push("drop shadow");
        if (effects.innerShadow?.some((e: any) => e.enabled !== false)) activeEffects.push("inner shadow");
        if (effects.outerGlow?.enabled !== false && effects.outerGlow) activeEffects.push("glow");
        if (effects.stroke?.some((e: any) => e.enabled !== false)) activeEffects.push("stroke");
        if (effects.gradientOverlay?.some((e: any) => e.enabled !== false)) activeEffects.push("gradient overlay");

        if (activeEffects.length > 0) {
          issues.push({
            code: "LAYER_EFFECT_NOT_REPRODUCED",
            severity: "warning",
            message: `Layer "${layerName}" contains layer effect(s) (${activeEffects.join(", ")}) that cannot be rendered. Consider rasterizing the layer in Photoshop.`,
            layerName,
          });
        }
      }

      // Check blend mode
      const rawBlend = (layer.blendMode ?? "normal").toLowerCase();
      if (!SUPPORTED_BLEND_MODES[rawBlend]) {
        issues.push({
          code: "UNSUPPORTED_BLEND_MODE",
          severity: "warning",
          message: `Layer "${layerName}" uses unsupported blend mode "${rawBlend}". Falling back to normal blend.`,
          layerName,
        });
      }

      if (isPlaceholder) {
        const rawKey = layerName.slice(prefix.length);
        const key = sanitizeKey(rawKey) || "placeholder";
        const type = inferPlaceholderType(key);

        const left = layer.left ?? 0;
        const top = layer.top ?? 0;
        const right = layer.right ?? (left + 100);
        const bottom = layer.bottom ?? (top + 100);
        const w = Math.max(1, right - left);
        const h = Math.max(1, bottom - top);

        const id = `ph_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

        if (parentGroup && (parentGroup.opacity !== undefined && parentGroup.opacity < 0.999 || parentGroup.mask || parentGroup.blendMode && parentGroup.blendMode !== "pass through" && parentGroup.blendMode !== "normal")) {
          issues.push({
            code: "PLACEHOLDER_IN_ISOLATED_GROUP",
            severity: "warning",
            message: `Placeholder "${layerName}" is inside group "${parentGroup.name}" which has group opacity, mask, or blend mode.`,
            layerName,
            placeholderId: id,
          });
        }

        const placeholder: DetectedPlaceholder = {
          id,
          key,
          type,
          layerName,
          box: { x: left, y: top, w, h },
          options: {
            fit: "cover",
            align: "left",
            maxLines: 1,
            sampleValue: type === "image" ? "/jamie.png" : "Jamie Park",
          },
          layer,
          parentPath: [...parentPath],
          inheritedOpacity: layerOpacity < 0.999 ? Number(layerOpacity.toFixed(3)) : undefined,
        };

        stream.push({
          isPlaceholder: true,
          placeholder,
          layer,
          opacity: layerOpacity,
          blendMode: rawBlend,
          inheritedOpacity: placeholder.inheritedOpacity,
        });
        continue;
      }

      // If this is a group
      if (layer.children && Array.isArray(layer.children)) {
        const isIsolated =
          (layer.opacity !== undefined && layer.opacity < 0.999) ||
          !!layer.mask ||
          (layer.blendMode && layer.blendMode !== "pass through" && layer.blendMode !== "normal");

        // Check if group contains any placeholders
        const hasPlaceholder = hasPlaceholderChild(layer, prefix);

        if (!isIsolated || hasPlaceholder) {
          // Unfold children directly into stream
          processLayers(layer.children, [...parentPath, layerName], layerOpacity, isIsolated ? layer : undefined);
        } else {
          // Isolated group without placeholders: render to an offscreen canvas and composite as one layer
          const groupCanvas = renderGroupCanvas(layer, psd.width, psd.height);
          if (groupCanvas) {
            stream.push({
              isPlaceholder: false,
              layer,
              canvas: groupCanvas,
              opacity: layer.opacity ?? 1,
              blendMode: rawBlend,
            });
          }
        }
        continue;
      }

      // Standard non-placeholder layer
      if (layer.canvas) {
        let layerCanvas: CanvasInstance = layer.canvas;

        // Apply layer mask if present
        if (layer.mask && (layer.mask as any).canvas) {
          const maskedCanvas = createCanvas(layer.canvas.width, layer.canvas.height);
          const mCtx = maskedCanvas.getContext("2d");
          mCtx.drawImage(layer.canvas as any, 0, 0);
          mCtx.globalCompositeOperation = "destination-in";
          mCtx.drawImage((layer.mask as any).canvas, 0, 0);
          layerCanvas = maskedCanvas;
        }

        stream.push({
          isPlaceholder: false,
          layer,
          canvas: layerCanvas,
          opacity: layerOpacity,
          blendMode: rawBlend,
        });
      }
    }
  }

  processLayers(psd.children, [], 1.0);
  return stream;
}

function hasPlaceholderChild(layer: Layer, prefix: string): boolean {
  if (!layer.children) return false;
  for (const child of layer.children) {
    if (child.name?.startsWith(prefix)) return true;
    if (child.children && hasPlaceholderChild(child, prefix)) return true;
  }
  return false;
}

function renderGroupCanvas(group: Layer, width: number, height: number): CanvasInstance | null {
  if (!group.children || group.children.length === 0) return null;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Children bottom to top
  for (let i = group.children.length - 1; i >= 0; i--) {
    const child = group.children[i];
    if (child.hidden || !child.canvas) continue;
    const left = child.left ?? 0;
    const top = child.top ?? 0;
    ctx.drawImage(child.canvas as any, left, top);
  }

  return canvas;
}

/**
 * Main slicer pipeline running in browser Web Worker or Node tests.
 */
export async function slicePsd(
  psdData: ArrayBuffer | Uint8Array,
  options: SliceOptions = {}
): Promise<SlicerResult> {
  const prefix = options.prefix ?? "#PLACEHOLDER_";
  const onProgress = options.onProgress ?? (() => {});

  onProgress("reading", 10);
  preflightCheck(psdData, { maxSizeBytes: options.maxFileSizeBytes });

  onProgress("parsing", 25);
  let psd: Psd;
  try {
    psd = readPsd(psdData, { skipLayerImageData: false, skipThumbnail: true });
  } catch (err) {
    throw new Error(`Failed to parse PSD document: ${err instanceof Error ? err.message : String(err)}`);
  }

  const maxSide = options.maxCanvasSide ?? 10_000;
  const maxPixels = options.maxCanvasPixels ?? 100_000_000;

  if (psd.width > maxSide || psd.height > maxSide || psd.width * psd.height > maxPixels) {
    throw new Error(
      `Canvas dimensions (${psd.width}x${psd.height}) exceed limits (maximum ${maxSide}px per side and ${maxPixels / 1_000_000} MP).`
    );
  }

  onProgress("detecting", 40);
  const detectedPlaceholders = detectPlaceholders(psd, prefix, {
    caseSensitive: options.caseSensitive,
  });

  const issues: ValidationIssue[] = [];
  if (detectedPlaceholders.length === 0) {
    issues.push({
      code: "ZERO_PLACEHOLDERS",
      severity: "error",
      message: `No placeholder layers detected with prefix "${prefix}".`,
    });
  }

  // Duplicate key conflicts
  const keyTypeMap = new Map<string, Set<string>>();
  for (const p of detectedPlaceholders) {
    const set = keyTypeMap.get(p.key) ?? new Set<string>();
    set.add(p.type);
    keyTypeMap.set(p.key, set);
  }
  for (const [key, types] of keyTypeMap.entries()) {
    if (types.size > 1) {
      issues.push({
        code: "DUPLICATE_KEY_CONFLICT",
        severity: "error",
        message: `Multiple placeholders share key "${key}" with conflicting types (${Array.from(types).join(", ")}).`,
      });
    }
  }

  onProgress("slicing", 60);
  const stream = flattenLayerTreeBottomToTop(psd, prefix, issues);

  // Compute preview scaling factor (~1200px width)
  const targetPreviewWidth = 1200;
  const scale = Math.min(1, targetPreviewWidth / psd.width);
  const previewWidth = Math.max(1, Math.round(psd.width * scale));
  const previewHeight = Math.max(1, Math.round(psd.height * scale));

  const items: ManifestItem[] = [];
  const assets: SlicedAsset[] = [];
  const manifestPlaceholders: ManifestPlaceholder[] = [];
  const fonts: ManifestFont[] = [];
  const fontFamilies = new Set<string>();

  // Current slice accumulation canvas
  let currentSliceCanvas: CanvasInstance = createCanvas(psd.width, psd.height);
  let currentSliceCtx = currentSliceCanvas.getContext("2d");
  let sliceHasContent = false;
  let sliceCounter = 0;

  async function flushCurrentSlice() {
    if (!sliceHasContent) return;
    const trimmed = trimCanvas(currentSliceCanvas);
    if (!trimmed.canvas || trimmed.w === 0 || trimmed.h === 0) {
      sliceHasContent = false;
      currentSliceCanvas = createCanvas(psd.width, psd.height);
      currentSliceCtx = currentSliceCanvas.getContext("2d");
      return;
    }

    sliceCounter++;
    const sliceId = `slice_${sliceCounter}_${trimmed.x}_${trimmed.y}`;

    // Full tier
    const fullBlob = await canvasToBlob(trimmed.canvas, "image/png");
    const fullSha256 = await computeSha256(fullBlob);
    const fullRef: AssetRef = {
      key: `slices/${fullSha256}.png`,
      url: `/api/public/assets/slices/${fullSha256}.png`,
      bytes: fullBlob.size,
      sha256: fullSha256,
      width: trimmed.w,
      height: trimmed.h,
      contentType: "image/png",
    };
    assets.push({
      kind: "slice",
      tier: "full",
      sha256: fullSha256,
      bytes: fullBlob.size,
      width: trimmed.w,
      height: trimmed.h,
      blob: fullBlob,
      contentType: "image/png",
    });

    // Preview tier
    const prevW = Math.max(1, Math.round(trimmed.w * scale));
    const prevH = Math.max(1, Math.round(trimmed.h * scale));
    const prevCanvas = createCanvas(prevW, prevH);
    const prevCtx = prevCanvas.getContext("2d");
    prevCtx.imageSmoothingQuality = "high";
    prevCtx.drawImage(trimmed.canvas, 0, 0, trimmed.w, trimmed.h, 0, 0, prevW, prevH);

    const prevBlob = await canvasToBlob(prevCanvas, "image/png");
    const prevSha256 = await computeSha256(prevBlob);
    const prevRef: AssetRef = {
      key: `slices/${prevSha256}.png`,
      url: `/api/public/assets/slices/${prevSha256}.png`,
      bytes: prevBlob.size,
      sha256: prevSha256,
      width: prevW,
      height: prevH,
      contentType: "image/png",
    };
    assets.push({
      kind: "slice",
      tier: "preview",
      sha256: prevSha256,
      bytes: prevBlob.size,
      width: prevW,
      height: prevH,
      blob: prevBlob,
      contentType: "image/png",
    });

    items.push({
      kind: "slice",
      id: sliceId,
      x: trimmed.x,
      y: trimmed.y,
      w: trimmed.w,
      h: trimmed.h,
      assets: {
        preview: prevRef,
        full: fullRef,
      },
    });

    // Reset slice accumulator
    sliceHasContent = false;
    currentSliceCanvas = createCanvas(psd.width, psd.height);
    currentSliceCtx = currentSliceCanvas.getContext("2d");
  }

  // Walk flattened stream
  for (const streamItem of stream) {
    if (streamItem.isPlaceholder && streamItem.placeholder) {
      await flushCurrentSlice();

      const p = streamItem.placeholder;

      // Extract text style and register fonts
      let textStyle: PlaceholderTextStyle | undefined;
      let maskRef: { preview: AssetRef; full: AssetRef } | undefined;

      if (p.type === "text" && p.layer) {
        textStyle = extractTextStyle(p.layer);
        if (textStyle?.fontFamily && !fontFamilies.has(textStyle.fontFamily)) {
          fontFamilies.add(textStyle.fontFamily);
          fonts.push({
            family: textStyle.fontFamily,
            style: textStyle.fontStyle,
            missing: true, // flagged until matched
          });
        }
      } else if (p.type === "image" && p.layer) {
        // Extract alpha mask if available
        const maskCanvas = extractAlphaMaskCanvas(p.layer, p.box.w, p.box.h);
        if (maskCanvas) {
          const fullMaskBlob = await canvasToBlob(maskCanvas, "image/png");
          const fullMaskSha = await computeSha256(fullMaskBlob);
          const fullMaskRef: AssetRef = {
            key: `masks/${fullMaskSha}.png`,
            url: `/api/public/assets/masks/${fullMaskSha}.png`,
            bytes: fullMaskBlob.size,
            sha256: fullMaskSha,
            width: maskCanvas.width,
            height: maskCanvas.height,
            contentType: "image/png",
          };
          assets.push({
            kind: "mask",
            tier: "full",
            sha256: fullMaskSha,
            bytes: fullMaskBlob.size,
            width: maskCanvas.width,
            height: maskCanvas.height,
            blob: fullMaskBlob,
            contentType: "image/png",
          });

          const prevMaskW = Math.max(1, Math.round(maskCanvas.width * scale));
          const prevMaskH = Math.max(1, Math.round(maskCanvas.height * scale));
          const prevMaskCanvas = createCanvas(prevMaskW, prevMaskH);
          const pCtx = prevMaskCanvas.getContext("2d");
          pCtx.drawImage(maskCanvas, 0, 0, maskCanvas.width, maskCanvas.height, 0, 0, prevMaskW, prevMaskH);

          const prevMaskBlob = await canvasToBlob(prevMaskCanvas, "image/png");
          const prevMaskSha = await computeSha256(prevMaskBlob);
          const prevMaskRef: AssetRef = {
            key: `masks/${prevMaskSha}.png`,
            url: `/api/public/assets/masks/${prevMaskSha}.png`,
            bytes: prevMaskBlob.size,
            sha256: prevMaskSha,
            width: prevMaskW,
            height: prevMaskH,
            contentType: "image/png",
          };
          assets.push({
            kind: "mask",
            tier: "preview",
            sha256: prevMaskSha,
            bytes: prevMaskBlob.size,
            width: prevMaskW,
            height: prevMaskH,
            blob: prevMaskBlob,
            contentType: "image/png",
          });

          maskRef = {
            preview: prevMaskRef,
            full: fullMaskRef,
          };
          p.options.useShapeAsMask = true;
        }
      }

      // Carry over designer overrides if any
      if (options.designerOverrides) {
        const match = options.designerOverrides.find(
          (o) => o.key === p.key && o.type === p.type
        );
        if (match) {
          p.options = { ...p.options, ...match.options };
          if (match.sampleValue) p.options.sampleValue = match.sampleValue;
        }
      }

      const manifestPlaceholder: ManifestPlaceholder = {
        id: p.id,
        key: p.key,
        type: p.type,
        layerName: p.layerName,
        box: p.box,
        options: p.options,
        textStyle,
        mask: maskRef,
      };

      manifestPlaceholders.push(manifestPlaceholder);
      items.push({
        kind: "placeholder",
        placeholderId: p.id,
        inheritedOpacity: streamItem.inheritedOpacity,
      });
    } else if (streamItem.canvas) {
      // Draw layer onto slice canvas
      currentSliceCtx.save();
      const compOp = SUPPORTED_BLEND_MODES[streamItem.blendMode] ?? "source-over";
      currentSliceCtx.globalCompositeOperation = compOp;
      currentSliceCtx.globalAlpha = streamItem.opacity;

      const left = streamItem.layer?.left ?? 0;
      const top = streamItem.layer?.top ?? 0;
      currentSliceCtx.drawImage(streamItem.canvas as any, left, top);
      currentSliceCtx.restore();

      sliceHasContent = true;
    }
  }

  // Flush final slice
  await flushCurrentSlice();

  onProgress("encoding", 80);

  // Compute total bytes for preview and full tiers
  let totalPreviewBytes = 0;
  let totalFullBytes = 0;
  for (const a of assets) {
    if (a.tier === "preview") totalPreviewBytes += a.bytes;
    if (a.tier === "full") totalFullBytes += a.bytes;
  }

  const tiers: { preview: Tier; full: Tier } = {
    preview: {
      scale,
      width: previewWidth,
      height: previewHeight,
      totalBytes: totalPreviewBytes,
    },
    full: {
      scale: 1.0,
      width: psd.width,
      height: psd.height,
      totalBytes: totalFullBytes,
    },
  };

  onProgress("verifying", 90);

  // Fidelity check: compare recomposited flyer with psd.canvas
  let fidelityScore = 1.0;
  const fidelityWarnings: string[] = [];

  if (psd.canvas) {
    try {
      // Downscale both to ~600px max side for fast pixel comparison
      const checkScale = Math.min(1, 600 / Math.max(psd.width, psd.height));
      const checkW = Math.max(1, Math.round(psd.width * checkScale));
      const checkH = Math.max(1, Math.round(psd.height * checkScale));

      const psdDown = createCanvas(checkW, checkH);
      const psdDownCtx = psdDown.getContext("2d");
      psdDownCtx.drawImage(psd.canvas as any, 0, 0, psd.width, psd.height, 0, 0, checkW, checkH);

      const compDown = createCanvas(checkW, checkH);
      const compDownCtx = compDown.getContext("2d");

      // Draw items in bottom-to-top order
      for (const item of items) {
        if (item.kind === "slice") {
          const a = assets.find((x) => x.tier === "full" && x.sha256 === item.assets.full.sha256);
          if (a) {
            const img = await loadImageBitmap(a.blob);
            compDownCtx.drawImage(
              img,
              0,
              0,
              item.w,
              item.h,
              Math.round(item.x * checkScale),
              Math.round(item.y * checkScale),
              Math.max(1, Math.round(item.w * checkScale)),
              Math.max(1, Math.round(item.h * checkScale))
            );
          }
        } else if (item.kind === "placeholder") {
          const p = detectedPlaceholders.find((dp) => dp.id === item.placeholderId);
          if (p?.layer?.canvas) {
            compDownCtx.drawImage(
              p.layer.canvas as any,
              0,
              0,
              p.box.w,
              p.box.h,
              Math.round(p.box.x * checkScale),
              Math.round(p.box.y * checkScale),
              Math.max(1, Math.round(p.box.w * checkScale)),
              Math.max(1, Math.round(p.box.h * checkScale))
            );
          }
        }
      }

      const imgDataA = psdDownCtx.getImageData(0, 0, checkW, checkH);
      const imgDataB = compDownCtx.getImageData(0, 0, checkW, checkH);
      const totalPixels = checkW * checkH;

      const diffPixels = pixelmatch(
        imgDataA.data,
        imgDataB.data,
        null,
        checkW,
        checkH,
        { threshold: 0.15 }
      );

      const rawScore = 1 - diffPixels / totalPixels;
      fidelityScore = Math.max(0, Math.min(1, Number(rawScore.toFixed(3))));

      const minFidelity = options.fidelityThreshold ?? 0.85;
      if (fidelityScore < minFidelity) {
        fidelityWarnings.push(
          `Visual fidelity score (${Math.round(fidelityScore * 100)}%) is below the recommended threshold (${Math.round(minFidelity * 100)}%).`
        );
      }
    } catch (fidErr) {
      fidelityWarnings.push(`Could not run pixel-diff fidelity check: ${fidErr}`);
    }
  }

  // Slice count check
  const sliceCount = items.filter((i) => i.kind === "slice").length;
  if (sliceCount > 12) {
    issues.push({
      code: "SLICE_COUNT_HIGH",
      severity: "warning",
      message: `Flyer contains ${sliceCount} slices (exceeds recommended max of 12).`,
    });
  }

  // Budget check
  const budget = options.budgetPreviewBytes ?? 2.5 * 1024 * 1024;
  if (totalPreviewBytes > budget) {
    issues.push({
      code: "OVER_BUDGET",
      severity: "warning",
      message: `Preview tier total size (${(totalPreviewBytes / (1024 * 1024)).toFixed(2)} MB) exceeds the budget of ${(budget / (1024 * 1024)).toFixed(1)} MB.`,
    });
  }

  // Missing fonts
  for (const f of fonts) {
    issues.push({
      code: "MISSING_FONTS",
      severity: "warning",
      message: `Font "${f.family}" was extracted from PSD and is flagged as missing until uploaded or linked.`,
    });
  }

  const manifest: FlyerManifest = {
    version: 1,
    width: psd.width,
    height: psd.height,
    tiers,
    items,
    placeholders: manifestPlaceholders,
    fonts,
    fidelity: {
      score: fidelityScore,
      method: "pixel-diff",
      warnings: fidelityWarnings,
    },
    generator: {
      app: "I Will Be There",
      psdLayerCount: psd.children?.length ?? 0,
      createdAt: new Date().toISOString(),
    },
  };

  let compositeBlob: Blob | undefined;
  if (psd.canvas) {
    compositeBlob = await canvasToBlob(psd.canvas as any, "image/png");
  }

  onProgress("verifying", 100);

  return {
    manifest,
    assets,
    validationIssues: issues,
    compositeBlob,
  };
}

function trimmedCanvasFromAsset(asset: SlicedAsset, w: number, h: number): CanvasInstance {
  const canvas = createCanvas(w, h);
  // If in node and canvas has buffer or image
  return canvas;
}

/**
 * Creates a flattened fallback where PSD composite is exported as a single slice.
 */
export async function createFlattenedFallback(
  psdData: ArrayBuffer | Uint8Array,
  placeholders: ManifestPlaceholder[]
): Promise<SlicerResult> {
  const psd = readPsd(psdData, { skipLayerImageData: false, skipThumbnail: true });
  if (!psd.canvas) {
    throw new Error("PSD does not contain an embedded composite canvas for flattened fallback.");
  }

  const targetPreviewWidth = 1200;
  const scale = Math.min(1, targetPreviewWidth / psd.width);
  const previewWidth = Math.max(1, Math.round(psd.width * scale));
  const previewHeight = Math.max(1, Math.round(psd.height * scale));

  const fullBlob = await canvasToBlob(psd.canvas as any, "image/png");
  const fullSha = await computeSha256(fullBlob);

  const prevCanvas = createCanvas(previewWidth, previewHeight);
  const prevCtx = prevCanvas.getContext("2d");
  prevCtx.drawImage(psd.canvas as any, 0, 0, psd.width, psd.height, 0, 0, previewWidth, previewHeight);
  const prevBlob = await canvasToBlob(prevCanvas, "image/png");
  const prevSha = await computeSha256(prevBlob);

  const fullRef: AssetRef = {
    key: `slices/${fullSha}.png`,
    url: `/api/public/assets/slices/${fullSha}.png`,
    bytes: fullBlob.size,
    sha256: fullSha,
    width: psd.width,
    height: psd.height,
    contentType: "image/png",
  };

  const prevRef: AssetRef = {
    key: `slices/${prevSha}.png`,
    url: `/api/public/assets/slices/${prevSha}.png`,
    bytes: prevBlob.size,
    sha256: prevSha,
    width: previewWidth,
    height: previewHeight,
    contentType: "image/png",
  };

  const items: ManifestItem[] = [
    {
      kind: "slice",
      id: "slice_fallback_single",
      x: 0,
      y: 0,
      w: psd.width,
      h: psd.height,
      assets: {
        preview: prevRef,
        full: fullRef,
      },
    },
    ...placeholders.map((p) => ({
      kind: "placeholder" as const,
      placeholderId: p.id,
    })),
  ];

  const assets: SlicedAsset[] = [
    {
      kind: "slice",
      tier: "full",
      sha256: fullSha,
      bytes: fullBlob.size,
      width: psd.width,
      height: psd.height,
      blob: fullBlob,
      contentType: "image/png",
    },
    {
      kind: "slice",
      tier: "preview",
      sha256: prevSha,
      bytes: prevBlob.size,
      width: previewWidth,
      height: previewHeight,
      blob: prevBlob,
      contentType: "image/png",
    },
  ];

  const manifest: FlyerManifest = {
    version: 1,
    width: psd.width,
    height: psd.height,
    tiers: {
      preview: {
        scale,
        width: previewWidth,
        height: previewHeight,
        totalBytes: prevBlob.size,
      },
      full: {
        scale: 1,
        width: psd.width,
        height: psd.height,
        totalBytes: fullBlob.size,
      },
    },
    items,
    placeholders,
    fonts: [],
    fidelity: {
      score: 1.0,
      method: "pixel-diff",
      warnings: ["Using flattened fallback composite; decorative layers above placeholders will be covered."],
    },
    generator: {
      app: "I Will Be There",
      psdLayerCount: psd.children?.length ?? 1,
      createdAt: new Date().toISOString(),
    },
  };

  return {
    manifest,
    assets,
    validationIssues: [],
    compositeBlob: fullBlob,
  };
}
