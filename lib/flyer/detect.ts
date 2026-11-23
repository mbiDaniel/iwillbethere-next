import type { Layer, Psd } from "ag-psd";
import { ManifestPlaceholder, PlaceholderOptions } from "./types";

export interface ManualPlaceholderMapping {
  layerPath: string;
  key: string;
  type: "text" | "image";
}

export interface PsdLayerDescriptor {
  layerPath: string;
  name: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  hasPlaceholderTag: boolean;
}

export interface DetectedPlaceholder {
  id: string;
  key: string;
  type: "text" | "image";
  layerName: string;
  box: { x: number; y: number; w: number; h: number };
  options: PlaceholderOptions;
  layer: Layer;
  parentPath: string[];
  inheritedOpacity?: number;
}

/**
 * Sanitizes an extracted placeholder key string.
 * Strips dangerous/special chars, collapses dots and whitespace, limits length.
 */
export function sanitizeKey(raw: string): string {
  return raw
    .trim()
    .replace(/[<>"'`\/\\]/g, "")
    .replace(/\.\.+/g, ".")
    .replace(/\s+/g, " ")
    .slice(0, 50);
}

/**
 * Infers placeholder type ("image" or "text") based on key words.
 */
export function inferPlaceholderType(key: string): "text" | "image" {
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

/**
 * Generates default options for a placeholder based on its type and key.
 */
export function getDefaultOptions(type: "text" | "image", key: string): PlaceholderOptions {
  if (type === "image") {
    return {
      fit: "cover",
      useShapeAsMask: false,
      framingMode: "center",
      sampleValue: "/jamie.png",
    };
  }
  return {
    align: "left",
    maxLines: 1,
    maxLength: 100,
    fontSize: 48,
    sampleValue: key.toLowerCase().includes("name") ? "Jamie Park" : `Sample ${key}`,
  };
}

/**
 * Recursively scans a PSD layer tree to detect placeholder layers matching a prefix.
 */
export function detectPlaceholders(
  psd: Psd,
  prefix = "#PLACEHOLDER_",
  options?: {
    caseSensitive?: boolean;
    manualPlaceholders?: ManualPlaceholderMapping[];
  }
): DetectedPlaceholder[] {
  const results: DetectedPlaceholder[] = [];
  const isCaseSensitive = options?.caseSensitive ?? true;
  const manualMappings = new Map(
    (options?.manualPlaceholders ?? []).map((mapping) => [mapping.layerPath, mapping])
  );

  function traverse(
    layers: Layer[] | undefined,
    parentPath: string[],
    parentOpacity: number,
    parentIndices: number[]
  ) {
    if (!layers || !Array.isArray(layers)) return;

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      if (layer.hidden) continue;

      const layerOpacity = (layer.opacity ?? 1) * parentOpacity;
      const layerName = layer.name ?? "";
      const layerPath = [...parentIndices, index].join(".");
      const manualMapping = manualMappings.get(layerPath);
      const matchesPrefix = isCaseSensitive
        ? layerName.startsWith(prefix)
        : layerName.toLowerCase().startsWith(prefix.toLowerCase());

      if (matchesPrefix || manualMapping) {
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

        results.push({
          id,
          key,
          type,
          layerName,
          box: { x: left, y: top, w, h },
          options: getDefaultOptions(type, key),
          layer,
          parentPath: [...parentPath],
          inheritedOpacity: layerOpacity < 0.999 ? Number(layerOpacity.toFixed(3)) : undefined,
        });
      }

      if (layer.children && Array.isArray(layer.children)) {
        traverse(layer.children, [...parentPath, layerName], layerOpacity, [...parentIndices, index]);
      }
    }
  }

  traverse(psd.children, [], 1.0, []);
  return results;
}

/**
 * Carries over designer overrides from existing placeholders to freshly detected ones.
 * Matches by key and type.
 */
export function carryOverOverrides(
  detected: DetectedPlaceholder[],
  existing: Array<{
    key: string;
    type: "text" | "image";
    options: PlaceholderOptions;
    sampleValue?: string;
  }>
): DetectedPlaceholder[] {
  const existingMap = new Map<string, (typeof existing)[0]>();

  for (const item of existing) {
    const mapKey = `${item.key.trim()}::${item.type}`;
    if (!existingMap.has(mapKey)) {
      existingMap.set(mapKey, item);
    }
  }

  return detected.map((d) => {
    const mapKey = `${d.key.trim()}::${d.type}`;
    const prev = existingMap.get(mapKey);
    if (prev) {
      return {
        ...d,
        options: {
          ...d.options,
          ...prev.options,
          sampleValue: prev.sampleValue ?? prev.options.sampleValue ?? d.options.sampleValue,
        },
      };
    }
    return d;
  });
}
