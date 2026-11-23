import type { Layer, Psd } from "ag-psd";
import { createCanvas } from "@napi-rs/canvas";
import {
  ExtractedPlaceholder,
  ExtractedTextStyle,
  PlaceholderBox,
  PlaceholderType,
} from "./types";
import { randomUUID } from "crypto";

export function sanitizeKey(raw: string): string {
  // Strip dangerous characters, collapse dots, trim, ensure safe for UI and data
  return raw
    .trim()
    .replace(/[<>"'`\/\\]/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/\s+/g, " ")
    .slice(0, 50);
}

export function inferPlaceholderType(key: string): PlaceholderType {
  const lower = key.toLowerCase();
  if (
    lower.includes("photo") ||
    lower.includes("image") ||
    lower.includes("avatar") ||
    lower.includes("pic") ||
    lower.includes("logo")
  ) {
    return "image";
  }
  return "text";
}

export interface FlattenedLayer {
  layer: Layer;
  id: string;
  isPlaceholder: boolean;
  placeholder?: ExtractedPlaceholder;
  zIndex: number;
}

export function extractTextStyle(layer: Layer): ExtractedTextStyle | undefined {
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

  return {
    fontFamily: style?.font?.name || "Arial",
    fontStyle: (style?.font as any)?.style || "Regular",
    fontSize: style?.fontSize ? Math.round(style.fontSize) : 24,
    color,
    align,
    lineHeight: style?.leading ? Math.round(style.leading) : undefined,
    tracking: style?.tracking ? Math.round(style.tracking) : undefined,
  };
}

export function extractAlphaMask(
  layer: Layer,
  box: PlaceholderBox
): Buffer | undefined {
  const width = box.wPx || 100;
  const height = box.hPx || 100;

  if (width <= 0 || height <= 0) return undefined;

  if (layer.canvas) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    // Draw the layer canvas onto our mask canvas
    ctx.drawImage(layer.canvas as any, 0, 0, width, height);

    // Check if the image has transparency
    const imgData = ctx.getImageData(0, 0, width, height);
    let hasTransparency = false;
    for (let i = 3; i < imgData.data.length; i += 4) {
      if (imgData.data[i] < 255) {
        hasTransparency = true;
        break;
      }
    }

    if (hasTransparency) {
      // Create pure alpha mask: white silhouette with alpha preserved
      for (let i = 0; i < imgData.data.length; i += 4) {
        imgData.data[i] = 255; // R
        imgData.data[i + 1] = 255; // G
        imgData.data[i + 2] = 255; // B
        // Alpha stays unchanged
      }
      ctx.putImageData(imgData, 0, 0);
      return canvas.toBuffer("image/png");
    }
  }

  return undefined;
}

export function flattenLayerTree(
  psd: Psd,
  prefix: string,
  previousOptionsMap: Map<string, ExtractedPlaceholder["options"]> = new Map()
): { flattenedLayers: FlattenedLayer[]; placeholders: ExtractedPlaceholder[] } {
  const flattened: FlattenedLayer[] = [];
  const placeholders: ExtractedPlaceholder[] = [];
  const psdWidth = psd.width;
  const psdHeight = psd.height;

  let zCounter = 0;

  function walk(layers: Layer[] = []) {
    // PSD layers in children are top to bottom, but we want bottom to top for z-order slicing!
    // So we iterate bottom to top
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];

      // If it's a group, walk its children
      if (layer.children && layer.children.length > 0) {
        walk(layer.children);
        continue;
      }

      // Check if layer is placeholder
      const layerName = layer.name || "";
      const isPlaceholder = layerName.startsWith(prefix);
      const layerId = `layer_${++zCounter}_${randomUUID().slice(0, 6)}`;

      if (isPlaceholder) {
        const rawKey = layerName.slice(prefix.length);
        const key = sanitizeKey(rawKey);
        const type = inferPlaceholderType(key);

        const left = Math.max(0, layer.left ?? 0);
        const top = Math.max(0, layer.top ?? 0);
        const right = Math.min(psdWidth, layer.right ?? psdWidth);
        const bottom = Math.min(psdHeight, layer.bottom ?? psdHeight);

        const wPx = Math.max(1, right - left);
        const hPx = Math.max(1, bottom - top);

        const box: PlaceholderBox = {
          x: Number(((left / psdWidth) * 100).toFixed(2)),
          y: Number(((top / psdHeight) * 100).toFixed(2)),
          w: Number(((wPx / psdWidth) * 100).toFixed(2)),
          h: Number(((hPx / psdHeight) * 100).toFixed(2)),
          xPx: left,
          yPx: top,
          wPx,
          hPx,
        };

        const textStyle = type === "text" ? extractTextStyle(layer) : undefined;
        const maskBuffer =
          type === "image" ? extractAlphaMask(layer, box) : undefined;

        // Check if layer is smart object or adjustment
        const isSmartObject = Boolean(layer.placedLayer);
        const isAdjustmentLayer = Boolean((layer as any).adjustment || (layer as any).adjustmentType);

        // Previous options carry over if key and type match
        const carryKey = `${key}:::${type}`;
        const prevOpts = previousOptionsMap.get(carryKey);

        const defaultOptions: ExtractedPlaceholder["options"] =
          type === "image"
            ? {
                fit: "cover",
                useShapeAsMask: Boolean(maskBuffer),
                framingMode: "center",
              }
            : {
                maxLines: 1,
                maxLength: 40,
                align: textStyle?.align || "left",
                fontSize: textStyle?.fontSize || 28,
                fallbackFont: "Arial",
              };

        const options = prevOpts
          ? {
              ...defaultOptions,
              ...prevOpts,
              ...(type === "text"
                ? {
                    fontSize:
                      prevOpts.fontSize ??
                      prevOpts.maxFontSize ??
                      defaultOptions.fontSize,
                  }
                : {}),
            }
          : defaultOptions;

        const placeholder: ExtractedPlaceholder = {
          id: key.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || `slot_${zCounter}`,
          layerId,
          layerName,
          key,
          type,
          sampleValue:
            type === "image" ? "/jamie.png" : layer.text?.text || "Jamie Park",
          box,
          options,
          textStyle,
          maskBuffer,
          isSmartObject,
          isAdjustmentLayer,
        };

        placeholders.push(placeholder);
        flattened.push({
          layer,
          id: layerId,
          isPlaceholder: true,
          placeholder,
          zIndex: zCounter,
        });
      } else {
        flattened.push({
          layer,
          id: layerId,
          isPlaceholder: false,
          zIndex: zCounter,
        });
      }
    }
  }

  walk(psd.children || []);

  return { flattenedLayers: flattened, placeholders };
}
