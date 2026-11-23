import { createCanvas } from "@napi-rs/canvas";
import type { ExtractedPlaceholder, ValidationIssue } from "./types";
import type { FlattenedLayer } from "./parser";

// Standard web safe and popular Google Fonts
const COMMON_FONTS = new Set([
  "arial",
  "helvetica",
  "times new roman",
  "times",
  "courier new",
  "courier",
  "verdana",
  "georgia",
  "palatino",
  "garamond",
  "bookman",
  "comic sans ms",
  "trebuchet ms",
  "arial black",
  "impact",
  "roboto",
  "open sans",
  "montserrat",
  "lato",
  "poppins",
  "inter",
  "playfair display",
  "space grotesk",
  "dm sans",
]);

export function validatePsd(
  placeholders: ExtractedPlaceholder[],
  flattenedLayers: FlattenedLayer[],
  eventFonts: string[] = []
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check 1: Zero placeholders
  if (placeholders.length === 0) {
    issues.push({
      code: "ZERO_PLACEHOLDERS",
      severity: "error",
      message:
        "No placeholder layers found. Name layers with the prefix (default #PLACEHOLDER_) to enable guest customization.",
    });
    return issues;
  }

  // Check 2 & 3: Smart object or adjustment layer placeholder
  for (const p of placeholders) {
    if (p.isSmartObject) {
      issues.push({
        code: "SMART_OBJECT_PLACEHOLDER",
        severity: "error",
        message: `Placeholder layer "${p.layerName}" is a Smart Object. Rasterize it or use a shape/text layer.`,
        layerName: p.layerName,
        placeholderId: p.id,
      });
    }
    if (p.isAdjustmentLayer) {
      issues.push({
        code: "ADJUSTMENT_LAYER_PLACEHOLDER",
        severity: "error",
        message: `Placeholder layer "${p.layerName}" is an adjustment layer. Adjustment layers cannot be placeholders.`,
        layerName: p.layerName,
        placeholderId: p.id,
      });
    }
  }

  // Check 4: Duplicate key with conflicting types
  const keyTypeMap = new Map<string, string>();
  for (const p of placeholders) {
    const existingType = keyTypeMap.get(p.key);
    if (existingType && existingType !== p.type) {
      issues.push({
        code: "DUPLICATE_KEY_CONFLICT",
        severity: "error",
        message: `Key "${p.key}" is used for both a ${existingType} and a ${p.type} placeholder. Use unique keys for different types.`,
        layerName: p.layerName,
        placeholderId: p.id,
      });
    } else {
      keyTypeMap.set(p.key, p.type);
    }
  }

  // Check 5: Missing fonts
  const fontFamiliesAvailable = new Set(
    eventFonts.map((f) => f.toLowerCase().trim())
  );
  for (const p of placeholders) {
    if (p.type === "text" && p.textStyle?.fontFamily) {
      const fam = p.textStyle.fontFamily.toLowerCase().trim();
      if (!COMMON_FONTS.has(fam) && !fontFamiliesAvailable.has(fam)) {
        issues.push({
          code: "MISSING_FONT",
          severity: "error",
          message: `Text placeholder "${p.layerName}" uses font "${p.textStyle.fontFamily}", which is not installed. Upload the font or use a standard font.`,
          layerName: p.layerName,
          placeholderId: p.id,
        });
      }
    }
  }

  // Check 6: Text smaller than 12px
  for (const p of placeholders) {
    if (p.type === "text" && p.textStyle?.fontSize) {
      if (p.textStyle.fontSize < 12) {
        issues.push({
          code: "TEXT_TOO_SMALL",
          severity: "warning",
          message: `Text layer "${p.layerName}" has a font size of ${p.textStyle.fontSize}px, which may be unreadable on mobile screens.`,
          layerName: p.layerName,
          placeholderId: p.id,
        });
      }
    }
  }

  // Check 7: Image placeholder without shape or alpha mask
  for (const p of placeholders) {
    if (p.type === "image" && !p.maskBuffer) {
      issues.push({
        code: "IMAGE_NO_MASK",
        severity: "warning",
        message: `Image placeholder "${p.layerName}" does not have transparency or a vector mask. A rectangular crop will be used.`,
        layerName: p.layerName,
        placeholderId: p.id,
      });
    }
  }

  // Check 8: Text box too small for sample value
  const measureCanvas = createCanvas(500, 200);
  const measureCtx = measureCanvas.getContext("2d");

  for (const p of placeholders) {
    if (p.type === "text" && p.sampleValue && p.box.wPx) {
      const minFont = p.options.fontSize ?? p.options.minFontSize ?? 9;
      measureCtx.font = `${minFont}px sans-serif`;
      const metrics = measureCtx.measureText(p.sampleValue);
      const textWidth = metrics.width;
      const maxLines = p.options.maxLines ?? 1;

      if (textWidth > p.box.wPx * maxLines * 1.05) {
        issues.push({
          code: "TEXT_BOX_TOO_SMALL",
          severity: "warning",
          message: `Text box for "${p.layerName}" is too narrow (${p.box.wPx}px) to fit the sample value "${p.sampleValue}" even at the minimum font size (${minFont}px).`,
          layerName: p.layerName,
          placeholderId: p.id,
        });
      }
    }
  }

  // Check 9: Unsupported blend modes in non-placeholder layers
  const supportedModes = new Set([
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
  ]);

  for (const { layer } of flattenedLayers) {
    if (layer.blendMode && !supportedModes.has(layer.blendMode.toLowerCase())) {
      issues.push({
        code: "UNSUPPORTED_BLEND_MODE",
        severity: "warning",
        message: `Layer "${layer.name}" uses blend mode "${layer.blendMode}", which may not render identically in all web browsers.`,
        layerName: layer.name,
      });
    }
  }

  // If no errors, add "ALL_VALID" passed notice
  const hasErrors = issues.some((i) => i.severity === "error");
  if (!hasErrors) {
    issues.unshift({
      code: "ALL_VALID",
      severity: "passed",
      message: "All placeholders are valid and ready for guest personalization.",
    });
  }

  return issues;
}
