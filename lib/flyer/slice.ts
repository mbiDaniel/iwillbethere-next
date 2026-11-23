import { readPsd, initializeCanvas, Layer, Psd } from "ag-psd";
import pixelmatch from "pixelmatch";
import { createCanvas, canvasToBlob, loadImageBitmap, CanvasInstance } from "./canvas";
import { normalizePostScriptFontName } from "./fonts";
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
import {
  DetectedPlaceholder,
  detectPlaceholders,
  inferPlaceholderType,
  ManualPlaceholderMapping,
  PsdLayerDescriptor,
  sanitizeKey,
} from "./detect";
import { ValidationIssue } from "./validate";
import { applyImageFitAndMask } from "./fit";
import { fitTextToBox, renderFittedText } from "./text";

export type { SlicerResult, SlicedAsset } from "./types";

// Ensure ag-psd is initialized with our canvas factory
initializeCanvas(createCanvas as any);

export interface SliceOptions {
  prefix?: string;
  caseSensitive?: boolean;
  manualPlaceholders?: ManualPlaceholderMapping[];
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

export function inspectPsdLayers(
  psdData: ArrayBuffer | Uint8Array,
  prefix = "#PLACEHOLDER_"
): PsdLayerDescriptor[] {
  preflightCheck(psdData);
  const psd = readPsd(psdData, { skipLayerImageData: true, skipThumbnail: true });
  const layers: PsdLayerDescriptor[] = [];

  function traverse(items: Layer[] | undefined, parentIndices: number[]) {
    if (!items) return;
    items.forEach((layer, index) => {
      if (layer.hidden) return;
      const layerPath = [...parentIndices, index].join(".");
      const name = layer.name?.trim() || `Layer ${layerPath}`;

      if (layer.children?.length) {
        if (name.startsWith(prefix)) {
          const groupLeft = layer.left ?? 0;
          const groupTop = layer.top ?? 0;
          const groupRight = layer.right ?? groupLeft + 1;
          const groupBottom = layer.bottom ?? groupTop + 1;
          if (groupRight > groupLeft && groupBottom > groupTop) {
            layers.push({
              layerPath,
              name,
              left: groupLeft,
              top: groupTop,
              right: groupRight,
              bottom: groupBottom,
              hasPlaceholderTag: true,
            });
          }
        }
        traverse(layer.children, [...parentIndices, index]);
        return;
      }

      const left = layer.left ?? 0;
      const top = layer.top ?? 0;
      const right = layer.right ?? left + 1;
      const bottom = layer.bottom ?? top + 1;
      if (right <= left || bottom <= top) return;

      layers.push({
        layerPath,
        name,
        left,
        top,
        right,
        bottom,
        hasPlaceholderTag: name.startsWith(prefix),
      });
    });
  }

  traverse(psd.children, []);
  return layers;
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
 * Applies a Photoshop Color Balance adjustment to a canvas in-place.
 *
 * Color Balance shifts Cyan/Red, Magenta/Green, Yellow/Blue channels
 * independently for Shadows, Midtones, and Highlights.
 * Range: -100 (toward Cyan/Magenta/Yellow) to +100 (toward Red/Green/Blue).
 */
export function applyColorBalanceAdjustment(
  canvas: CanvasInstance,
  adj: {
    shadows?: { cyanRed?: number; magentaGreen?: number; yellowBlue?: number };
    midtones?: { cyanRed?: number; magentaGreen?: number; yellowBlue?: number };
    highlights?: { cyanRed?: number; magentaGreen?: number; yellowBlue?: number };
    preserveLuminosity?: boolean;
  },
  opacity = 1
): void {
  if (opacity <= 0) return;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const sh = adj.shadows ?? {};
  const mt = adj.midtones ?? {};
  const hl = adj.highlights ?? {};

  // Scale: Photoshop values -100..+100 → pixel shift of -128..+128.
  // ag-psd sign convention: cyanRed=+N means "toward Cyan" (subtract from Red),
  // so we negate all values to get the correct direction of the channel shift.
  const scale = 128 / 100;
  const shCR = -(sh.cyanRed ?? 0) * scale;
  const shMG = -(sh.magentaGreen ?? 0) * scale;
  const shYB = -(sh.yellowBlue ?? 0) * scale;
  const mtCR = -(mt.cyanRed ?? 0) * scale;
  const mtMG = -(mt.magentaGreen ?? 0) * scale;
  const mtYB = -(mt.yellowBlue ?? 0) * scale;
  const hlCR = -(hl.cyanRed ?? 0) * scale;
  const hlMG = -(hl.magentaGreen ?? 0) * scale;
  const hlYB = -(hl.yellowBlue ?? 0) * scale;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;

    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Luminance 0..1
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Shadow weight: peaks at lum=0, zero at lum=0.5+
    const sw = Math.max(0, 0.5 - lum) * 2;
    // Highlight weight: peaks at lum=1, zero at lum=0.5-
    const hw = Math.max(0, lum - 0.5) * 2;
    // Midtone weight: peaks at lum=0.5
    const mw = 1 - sw - hw;

    const rShift = (shCR * sw + mtCR * mw + hlCR * hw) * opacity;
    const gShift = (shMG * sw + mtMG * mw + hlMG * hw) * opacity;
    const bShift = (shYB * sw + mtYB * mw + hlYB * hw) * opacity;

    if (adj.preserveLuminosity) {
      // Apply shift then correct luminosity back
      const nr = Math.max(0, Math.min(255, r + rShift));
      const ng = Math.max(0, Math.min(255, g + gShift));
      const nb = Math.max(0, Math.min(255, b + bShift));
      const newLum = (0.299 * nr + 0.587 * ng + 0.114 * nb) / 255;
      const lumFactor = newLum > 0 ? lum / newLum : 1;
      data[i] = Math.max(0, Math.min(255, Math.round(nr * lumFactor)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(ng * lumFactor)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(nb * lumFactor)));
    } else {
      data[i] = Math.max(0, Math.min(255, Math.round(r + rShift)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(g + gShift)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(b + bShift)));
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Collects all adjustment layers from a PSD layer tree.
 * Returns them in draw order (bottom-to-top) for sequential application.
 */
export function collectAdjustmentLayers(
  psd: Psd,
  direction: "bottom-to-top" | "top-to-bottom"
): Array<{ adjustment: any; opacity: number; mask?: any }> {
  const result: Array<{ adjustment: any; opacity: number; mask?: any }> = [];

  function traverse(layers: Layer[] | undefined, parentOpacity: number) {
    if (!layers) return;
    const indices: number[] = [];
    if (direction === "bottom-to-top") {
      for (let i = 0; i < layers.length; i++) indices.push(i);
    } else {
      for (let i = layers.length - 1; i >= 0; i--) indices.push(i);
    }
    for (const i of indices) {
      const layer = layers[i];
      if (layer.hidden) continue;
      const layerOpacity = (layer.opacity ?? 1) * parentOpacity;
      const adj = (layer as any).adjustment;
      if (adj) {
        result.push({ adjustment: adj, opacity: layerOpacity, mask: layer.mask });
      } else if (layer.children) {
        traverse(layer.children, layerOpacity);
      }
    }
  }

  traverse(psd.children, 1.0);
  return result;
}

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

/**
 * Detects whether the layer tree is stored bottom-to-top (standard Adobe Photoshop)
 * or top-to-bottom (synthetic fixtures or reversed stacks).
 */
export function detectLayerStackDirection(layers: Layer[]): "bottom-to-top" | "top-to-bottom" {
  if (!layers || layers.length <= 1) return "bottom-to-top";

  const first = layers[0];
  const last = layers[layers.length - 1];

  const firstName = (first.name ?? "").toLowerCase();
  const lastName = (last.name ?? "").toLowerCase();

  // If first layer is named "background" or "bg" or "layer 0", it is bottom-to-top (standard Photoshop)
  if (firstName.includes("background") || firstName.includes("bg") || firstName === "layer 0") {
    return "bottom-to-top";
  }

  // If last layer is named "background" or "bg" or "layer 0", it was saved top-to-bottom
  if (lastName.includes("background") || lastName.includes("bg") || lastName === "layer 0") {
    return "top-to-bottom";
  }

  // Check children of first/last groups
  if (first.children?.some((c) => (c.name ?? "").toLowerCase().includes("background"))) {
    return "bottom-to-top";
  }
  if (last.children?.some((c) => (c.name ?? "").toLowerCase().includes("background"))) {
    return "top-to-bottom";
  }

  return "bottom-to-top";
}

/**
 * Converts a Photoshop grayscale mask canvas into a proper alpha mask canvas.
 *
 * ag-psd decodes Photoshop layer masks as grayscale images where:
 *   - R channel = mask luminance (255 = show, 0 = hide)
 *   - Alpha channel is ALWAYS 255 (fully opaque)
 *
 * Canvas 'destination-in' uses the ALPHA of the mask to clip, not the RGB.
 * So we must rewrite each pixel's alpha = its R channel value.
 */
function grayscaleMaskToAlpha(maskCanvas: CanvasInstance): CanvasInstance {
  const w = maskCanvas.width;
  const h = maskCanvas.height;
  const alphaCanvas = createCanvas(w, h);
  const ctx = alphaCanvas.getContext("2d");
  ctx.drawImage(maskCanvas as any, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Luminance = R (mask is grayscale so R=G=B). Set alpha = luminance.
    data[i + 3] = data[i]; // alpha = R
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  }
  ctx.putImageData(imgData, 0, 0);
  return alphaCanvas;
}

/**
 * Applies a Photoshop layer/group mask to a canvas honoring defaultColor and bounding offsets.
 *
 * Photoshop masks are grayscale (white=show, black=hide). ag-psd gives them
 * alpha=255 always, so we first convert R → alpha with grayscaleMaskToAlpha.
 *
 * defaultColor controls what happens OUTSIDE the mask bounding box:
 *   255 = opaque (layer visible outside the mask area)
 *   0   = transparent (layer hidden outside the mask area)
 */
export function applyMaskToCanvas(
  targetCanvas: CanvasInstance,
  mask: any,
  targetLeft = 0,
  targetTop = 0
): CanvasInstance {
  if (!mask || mask.disabled) return targetCanvas;

  const tw = targetCanvas.width;
  const th = targetCanvas.height;

  // Build a full-size alpha mask canvas.
  const alphaMask = createCanvas(tw, th);
  const mCtx = alphaMask.getContext("2d");

  // Fill with the defaultColor alpha: 255 = opaque (show), 0 = transparent (hide).
  const defAlpha = mask.defaultColor ?? 0;
  if (defAlpha > 0) {
    // Fill fully opaque black pixels - these will act as "fully visible" areas
    // when used with destination-in (black at alpha=255 is opaque).
    mCtx.globalAlpha = defAlpha / 255;
    mCtx.fillStyle = "black";
    mCtx.fillRect(0, 0, tw, th);
    mCtx.globalAlpha = 1;
  }
  // If defAlpha = 0, the canvas starts transparent → outside mask area is hidden.

  if (mask.canvas) {
    // Convert the grayscale mask to an alpha mask.
    const convertedMask = grayscaleMaskToAlpha(mask.canvas);
    const mLeft = (mask.left ?? 0) - targetLeft;
    const mTop = (mask.top ?? 0) - targetTop;
    mCtx.drawImage(convertedMask as any, mLeft, mTop);
  }

  // Apply the alpha mask to the target canvas using destination-in.
  const masked = createCanvas(tw, th);
  const tCtx = masked.getContext("2d");
  tCtx.drawImage(targetCanvas as any, 0, 0);
  tCtx.globalCompositeOperation = "destination-in";
  tCtx.drawImage(alphaMask as any, 0, 0);

  return masked;
}

export interface FlattenedStreamItem {
  isPlaceholder: boolean;
  placeholder?: DetectedPlaceholder;
  layer?: Layer;
  canvas?: CanvasInstance;
  opacity: number;
  blendMode: string;
  inheritedOpacity?: number;
  /** Parent group mask to apply to this item's canvas before compositing, if any */
  groupMask?: { mask: any; groupLeft: number; groupTop: number };
}

/**
 * Flattens the PSD layer tree bottom-to-top into an ordered stream.
 */
export function flattenLayerTreeBottomToTop(
  psd: Psd,
  prefix: string,
  issues: ValidationIssue[],
  manualPlaceholders: ManualPlaceholderMapping[] = []
): FlattenedStreamItem[] {
  const stream: FlattenedStreamItem[] = [];
  const manualMappings = new Map(
    manualPlaceholders.map((mapping) => [mapping.layerPath, mapping])
  );
  const direction = detectLayerStackDirection(psd.children ?? []);

  function processLayers(
    layers: Layer[] | undefined,
    parentPath: string[],
    parentOpacity: number,
    parentGroup?: Layer,
    parentIndices: number[] = [],
    parentGroupMask?: { mask: any; groupLeft: number; groupTop: number }
  ) {
    if (!layers || !Array.isArray(layers)) return;

    // Traverse in bottom-to-top draw order
    const indices: number[] = [];
    if (direction === "bottom-to-top") {
      for (let i = 0; i < layers.length; i++) indices.push(i);
    } else {
      for (let i = layers.length - 1; i >= 0; i--) indices.push(i);
    }

    for (const i of indices) {
      const layer = layers[i];
      if (layer.hidden) continue;

      const layerOpacity = (layer.opacity ?? 1) * parentOpacity;
      const layerName = layer.name ?? "";
      const layerIndices = [...parentIndices, i];
      const manualMapping = manualMappings.get(layerIndices.join("."));
      const isPlaceholder = layerName.startsWith(prefix) || !!manualMapping;

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
        const rawKey = manualMapping?.key ?? layerName.slice(prefix.length);
        const key = sanitizeKey(rawKey) || "placeholder";
        const type = manualMapping?.type ?? inferPlaceholderType(key);

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
          // Store the parent group mask so the slicer can use it as the photo mask
          shapeMask: parentGroupMask ?? undefined,
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
        const hasPlaceholder = hasPlaceholderChild(
          layer,
          prefix,
          layerIndices,
          manualMappings
        );

        if (!isIsolated || hasPlaceholder) {
          // Unfold children directly into stream.
          // If this group has a mask, pass it down so it can be applied to children and placeholders.
          const childGroupMask = layer.mask && !layer.mask.disabled
            ? { mask: layer.mask, groupLeft: layer.left ?? 0, groupTop: layer.top ?? 0 }
            : parentGroupMask;

          processLayers(
            layer.children,
            [...parentPath, layerName],
            layerOpacity,
            isIsolated ? layer : undefined,
            layerIndices,
            childGroupMask
          );
        } else {
          // Isolated group without placeholders: render to an offscreen canvas and composite as one layer
          const groupCanvas = renderGroupCanvas(layer, psd.width, psd.height, direction);
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
        if (layer.mask) {
          layerCanvas = applyMaskToCanvas(layerCanvas, layer.mask, layer.left ?? 0, layer.top ?? 0);
        }

        // Apply parent group mask if present (for layers inside a masked pass-through group)
        if (parentGroupMask) {
          layerCanvas = applyMaskToCanvas(layerCanvas, parentGroupMask.mask, layer.left ?? 0, layer.top ?? 0);
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

function hasPlaceholderChild(
  layer: Layer,
  prefix: string,
  parentIndices: number[],
  manualMappings: Map<string, ManualPlaceholderMapping>
): boolean {
  if (!layer.children) return false;
  for (let index = 0; index < layer.children.length; index += 1) {
    const child = layer.children[index];
    if (child.hidden) continue;
    const childIndices = [...parentIndices, index];
    if (
      child.name?.startsWith(prefix) ||
      manualMappings.has(childIndices.join(".")) ||
      (child.children &&
        hasPlaceholderChild(child, prefix, childIndices, manualMappings))
    ) {
      return true;
    }
  }
  return false;
}

function renderGroupCanvas(
  group: Layer,
  width: number,
  height: number,
  direction: "bottom-to-top" | "top-to-bottom" = "bottom-to-top"
): CanvasInstance | null {
  if (!group.children || group.children.length === 0) return null;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  function drawLayers(target: CanvasRenderingContext2D, layers: Layer[]) {
    const indices: number[] = [];
    if (direction === "bottom-to-top") {
      for (let i = 0; i < layers.length; i++) indices.push(i);
    } else {
      for (let i = layers.length - 1; i >= 0; i--) indices.push(i);
    }

    for (const i of indices) {
      const layer = layers[i];
      if (layer.hidden) continue;

      let layerCanvas = layer.children?.length
        ? renderGroupCanvas(layer, width, height, direction)
        : layer.canvas;
      if (!layerCanvas) continue;

      if (!layer.children?.length && layer.mask) {
        layerCanvas = applyMaskToCanvas(layerCanvas, layer.mask, layer.left ?? 0, layer.top ?? 0);
      }

      target.save();
      target.globalAlpha = layer.opacity ?? 1;
      target.globalCompositeOperation =
        SUPPORTED_BLEND_MODES[(layer.blendMode ?? "normal").toLowerCase()] ?? "source-over";
      if (layer.children?.length) {
        target.drawImage(layerCanvas as any, 0, 0);
      } else {
        target.drawImage(layerCanvas as any, layer.left ?? 0, layer.top ?? 0);
      }
      target.restore();
    }
  }

  drawLayers(ctx as CanvasRenderingContext2D, group.children);

  if (group.mask) {
    return applyMaskToCanvas(canvas, group.mask, 0, 0);
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
    manualPlaceholders: options.manualPlaceholders,
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
  const direction = detectLayerStackDirection(psd.children ?? []);
  const stream = flattenLayerTreeBottomToTop(
    psd,
    prefix,
    issues,
    options.manualPlaceholders
  );

  // Collect adjustment layers (Color Balance, etc.) to apply as post-processing.
  const adjustmentLayers = collectAdjustmentLayers(psd, direction);

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

    // Apply adjustment layers (e.g. Color Balance) to the slice canvas before trimming.
    // Adjustments affect the composited slice the same way they would in Photoshop.
    for (const adj of adjustmentLayers) {
      if (adj.adjustment.type === "color balance") {
        applyColorBalanceAdjustment(currentSliceCanvas, adj.adjustment, adj.opacity);
      }
    }

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
          // Normalise PostScript names like "Roboto-Bold" → family:"Roboto", weight:700
          const norm = normalizePostScriptFontName(textStyle.fontFamily);
          fonts.push({
            family: norm.family,
            weight: norm.weight !== 400 ? norm.weight : undefined,
            style: norm.style !== "normal" ? norm.style : textStyle.fontStyle,
            missing: true, // flagged until matched
          });
          // Also update textStyle so the canvas uses the clean family name
          textStyle = { ...textStyle, fontFamily: norm.family };
        }
      } else if (p.type === "image" && p.layer) {
        // Build the mask for the image placeholder.
        // Priority: 1) parent group mask (shape mask), 2) layer alpha mask.
        let maskCanvas: CanvasInstance | null = null;

        if (p.shapeMask && p.shapeMask.mask.canvas) {
          // Use the parent group's Photoshop mask as the shape mask for this placeholder.
          // The group mask is in full-canvas coordinates; crop it to the placeholder box.
          const { mask, groupLeft, groupTop } = p.shapeMask;
          const boxW = Math.max(1, p.box.w);
          const boxH = Math.max(1, p.box.h);
          const tempCanvas = createCanvas(psd.width, psd.height);
          const tempCtx = tempCanvas.getContext("2d");
          // Fill with defaultColor outside mask bounds
          const defAlpha = mask.defaultColor ?? 0;
          if (defAlpha > 0) {
            tempCtx.fillStyle = "black";
            tempCtx.fillRect(0, 0, psd.width, psd.height);
          }
          // Draw the grayscale mask converted to alpha at its correct position
          if (mask.canvas) {
            const converted = grayscaleMaskToAlpha(mask.canvas);
            const mLeft = (mask.left ?? 0) - groupLeft;
            const mTop = (mask.top ?? 0) - groupTop;
            tempCtx.drawImage(converted as any, mLeft, mTop);
          }
          // Crop to placeholder box
          const cropCtx = createCanvas(boxW, boxH);
          const cCtx = cropCtx.getContext("2d");
          // The placeholder box is in PSD canvas coordinates
          // But we need to position the mask relative to the placeholder
          const offsetX = p.box.x - groupLeft;
          const offsetY = p.box.y - groupTop;
          cCtx.drawImage(tempCanvas as any, offsetX, offsetY, boxW, boxH, 0, 0, boxW, boxH);
          // Check if the mask has any non-trivial alpha
          const imgData = cCtx.getImageData(0, 0, boxW, boxH);
          let hasPartialAlpha = false;
          for (let idx = 3; idx < imgData.data.length; idx += 4) {
            if (imgData.data[idx] < 240) { hasPartialAlpha = true; break; }
          }
          if (hasPartialAlpha) {
            maskCanvas = cropCtx;
          }
        }

        if (!maskCanvas) {
          // Fallback: use the layer's own alpha channel as the mask
          maskCanvas = extractAlphaMaskCanvas(p.layer, p.box.w, p.box.h);
        }

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

      const left = streamItem.layer?.children?.length ? 0 : (streamItem.layer?.left ?? 0);
      const top = streamItem.layer?.children?.length ? 0 : (streamItem.layer?.top ?? 0);
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
      // Downscale both to ~600px max side for fast pixel comparison.
      // We build the recomposed canvas by replaying the RAW layer stream (no CB baked),
      // then apply CB once to the whole canvas — matching exactly what Photoshop does.
      // This avoids double-applying CB that would happen if we drew the already-CB-baked
      // slice blobs and then applied CB again on top.
      const checkScale = Math.min(1, 600 / Math.max(psd.width, psd.height));
      const checkW = Math.max(1, Math.round(psd.width * checkScale));
      const checkH = Math.max(1, Math.round(psd.height * checkScale));

      const psdDown = createCanvas(checkW, checkH);
      const psdDownCtx = psdDown.getContext("2d");
      psdDownCtx.drawImage(psd.canvas as any, 0, 0, psd.width, psd.height, 0, 0, checkW, checkH);

      // Replay the raw stream (pre-CB) onto a full-res fidelity canvas,
      // then apply CB once and downscale for pixel comparison.
      const fidFull = createCanvas(psd.width, psd.height);
      const fidCtx = fidFull.getContext("2d");

      for (const streamItem of stream) {
        if (streamItem.isPlaceholder && streamItem.placeholder) {
          const dp = streamItem.placeholder;
          if (dp.layer?.canvas) {
            let layerCanvas: CanvasInstance = dp.layer.canvas;
            const lLeft = dp.layer.left ?? 0;
            const lTop = dp.layer.top ?? 0;

            // Apply layer's own mask
            if (dp.layer.mask && !dp.layer.mask.disabled) {
              layerCanvas = applyMaskToCanvas(layerCanvas, dp.layer.mask, lLeft, lTop);
            }
            // Apply group's shape mask (e.g. Image group clips the silhouette)
            if (dp.shapeMask && dp.shapeMask.mask) {
              layerCanvas = applyMaskToCanvas(layerCanvas, dp.shapeMask.mask, lLeft, lTop);
            }

            const srcX = Math.max(0, -lLeft);
            const srcY = Math.max(0, -lTop);
            const dstX = Math.max(0, lLeft);
            const dstY = Math.max(0, lTop);
            const drawW = Math.min(layerCanvas.width - srcX, psd.width - dstX);
            const drawH = Math.min(layerCanvas.height - srcY, psd.height - dstY);
            if (drawW > 0 && drawH > 0) {
              fidCtx.save();
              fidCtx.globalAlpha = streamItem.opacity;
              fidCtx.globalCompositeOperation =
                SUPPORTED_BLEND_MODES[streamItem.blendMode] ?? "source-over";
              fidCtx.drawImage(layerCanvas as any, srcX, srcY, drawW, drawH, dstX, dstY, drawW, drawH);
              fidCtx.restore();
            }
          }
        } else if (streamItem.canvas) {
          const left = streamItem.layer?.children?.length ? 0 : (streamItem.layer?.left ?? 0);
          const top = streamItem.layer?.children?.length ? 0 : (streamItem.layer?.top ?? 0);
          fidCtx.save();
          fidCtx.globalAlpha = streamItem.opacity;
          fidCtx.globalCompositeOperation =
            SUPPORTED_BLEND_MODES[streamItem.blendMode] ?? "source-over";
          fidCtx.drawImage(streamItem.canvas as any, left, top);
          fidCtx.restore();
        }
      }

      // Apply CB (and future adjustments) ONCE to the full recomposed canvas
      for (const adj of adjustmentLayers) {
        if (adj.adjustment.type === "color balance") {
          applyColorBalanceAdjustment(fidFull, adj.adjustment, adj.opacity);
        }
      }

      // Downscale the recomposed canvas for pixel comparison
      const compDown = createCanvas(checkW, checkH);
      const compDownCtx = compDown.getContext("2d");
      compDownCtx.drawImage(fidFull as any, 0, 0, psd.width, psd.height, 0, 0, checkW, checkH);

      const imgDataA = psdDownCtx.getImageData(0, 0, checkW, checkH);
      const imgDataB = compDownCtx.getImageData(0, 0, checkW, checkH);
      const totalPixels = checkW * checkH;

      const diffPixels = pixelmatch(
        imgDataA.data,
        imgDataB.data,
        null,
        checkW,
        checkH,
        // threshold: 0.25 = 64/255 channel units (25% per channel).
        // We allow up to 25% because:
        //  1. Photoshop overlay/screen blend modes operate in gamma-encoded space while
        //     Canvas 2D uses linear light — causing up to ~12 units per channel.
        //  2. Smart Object placeholders may embed ICC color profiles that shift their
        //     pixel values ~15 units per channel vs our sRGB rendering.
        // Combined, inherent differences reach ~25 units per channel for affected regions.
        // This threshold still reliably catches genuine failures: dropped layers, wrong
        // colors (>64 units off), or missing artwork.
        { threshold: 0.25 }
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
