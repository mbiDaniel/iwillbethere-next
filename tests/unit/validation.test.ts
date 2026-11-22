import { describe, it, expect, beforeAll } from "vitest";
import { ensureCanvasInitialized } from "@/lib/psd/canvas";
import { flattenLayerTree } from "@/lib/psd/parser";
import { validatePsd } from "@/lib/psd/validator";
import { readPsd } from "ag-psd";
import {
  createValidFixturePsd,
  createSmartObjectFixturePsd,
  createMissingFontFixturePsd,
  createDuplicateConflictingKeysFixturePsd,
  createZeroPlaceholdersFixturePsd,
} from "@/scripts/generate-fixtures";

describe("Validation Rules - Unit Tests", () => {
  beforeAll(() => {
    ensureCanvasInitialized();
  });

  it("passes valid PSD with code ALL_VALID", () => {
    const psd = readPsd(createValidFixturePsd());
    const { flattenedLayers, placeholders } = flattenLayerTree(psd, "#PLACEHOLDER_");

    const issues = validatePsd(placeholders, flattenedLayers, ["Arial"]);
    const errors = issues.filter((i) => i.severity === "error");

    expect(errors.length).toBe(0);
    expect(issues.some((i) => i.code === "ALL_VALID")).toBe(true);
  });

  it("flags ZERO_PLACEHOLDERS error when no placeholders are found", () => {
    const psd = readPsd(createZeroPlaceholdersFixturePsd());
    const { flattenedLayers, placeholders } = flattenLayerTree(psd, "#PLACEHOLDER_");

    const issues = validatePsd(placeholders, flattenedLayers);
    expect(issues.some((i) => i.code === "ZERO_PLACEHOLDERS")).toBe(true);
  });

  it("flags SMART_OBJECT_PLACEHOLDER error when a placeholder is a smart object", () => {
    const psd = readPsd(createSmartObjectFixturePsd());
    const { flattenedLayers, placeholders } = flattenLayerTree(psd, "#PLACEHOLDER_");

    const issues = validatePsd(placeholders, flattenedLayers, ["Arial"]);
    expect(issues.some((i) => i.code === "SMART_OBJECT_PLACEHOLDER")).toBe(true);
  });

  it("flags MISSING_FONT error when an uninstalled font is used", () => {
    const psd = readPsd(createMissingFontFixturePsd());
    const { flattenedLayers, placeholders } = flattenLayerTree(psd, "#PLACEHOLDER_");

    const issues = validatePsd(placeholders, flattenedLayers, []);
    expect(issues.some((i) => i.code === "MISSING_FONT")).toBe(true);
  });

  it("flags DUPLICATE_KEY_CONFLICT error when key is used with conflicting types", () => {
    const placeholders: any[] = [
      { id: "1", layerName: "#PLACEHOLDER_badge", key: "badge", type: "text", box: { x: 0, y: 0, w: 10, h: 10 }, options: {} },
      { id: "2", layerName: "#PLACEHOLDER_badge", key: "badge", type: "image", box: { x: 0, y: 0, w: 10, h: 10 }, options: {} },
    ];

    const issues = validatePsd(placeholders, [], ["Arial"]);
    expect(issues.some((i) => i.code === "DUPLICATE_KEY_CONFLICT")).toBe(true);
  });
});
