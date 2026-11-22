import { DetectedPlaceholder } from "./detect";
import { FlyerManifest, ManifestFont } from "./types";

export type ValidationSeverity = "error" | "warning" | "passed";

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  layerName?: string;
  placeholderId?: string;
}

export interface ValidationConfig {
  maxPreviewBytesBudget?: number; // default: 2.5MB
  maxSliceCount?: number; // default: 12
  minFidelityThreshold?: number; // default: 0.85
}

export const DEFAULT_VALIDATION_CONFIG: Required<ValidationConfig> = {
  maxPreviewBytesBudget: 2.5 * 1024 * 1024, // 2.5MB
  maxSliceCount: 12,
  minFidelityThreshold: 0.85,
};

/**
 * Validates detected placeholders for duplicate keys and conflicts.
 */
export function validatePlaceholders(
  placeholders: DetectedPlaceholder[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (placeholders.length === 0) {
    issues.push({
      code: "ZERO_PLACEHOLDERS",
      severity: "error",
      message:
        "No placeholder layers detected. Add layers starting with #PLACEHOLDER_ (e.g. #PLACEHOLDER_name or #PLACEHOLDER_photo).",
    });
    return issues;
  }

  const keyMap = new Map<string, { type: "text" | "image"; name: string }[]>();
  for (const p of placeholders) {
    const list = keyMap.get(p.key) || [];
    list.push({ type: p.type, name: p.layerName });
    keyMap.set(p.key, list);
  }

  for (const [key, occurrences] of keyMap.entries()) {
    const types = new Set(occurrences.map((o) => o.type));
    if (types.size > 1) {
      issues.push({
        code: "DUPLICATE_KEY_CONFLICT",
        severity: "error",
        message: `Multiple placeholders share key "${key}" with conflicting types (${Array.from(types).join(", ")}).`,
        layerName: occurrences.map((o) => o.name).join(", "),
      });
    }
  }

  return issues;
}

/**
 * Validates manifest properties against budget, slice counts, fidelity, and fonts.
 */
export function validateManifest(
  manifest: FlyerManifest,
  config: ValidationConfig = {}
): ValidationIssue[] {
  const opts = { ...DEFAULT_VALIDATION_CONFIG, ...config };
  const issues: ValidationIssue[] = [];

  // Zero placeholders check
  if (manifest.placeholders.length === 0) {
    issues.push({
      code: "ZERO_PLACEHOLDERS",
      severity: "error",
      message: "Manifest contains no placeholders.",
    });
  }

  // Duplicate key conflicts in manifest
  const keyTypeMap = new Map<string, Set<string>>();
  for (const p of manifest.placeholders) {
    const set = keyTypeMap.get(p.key) ?? new Set<string>();
    set.add(p.type);
    keyTypeMap.set(p.key, set);
  }
  for (const [key, types] of keyTypeMap.entries()) {
    if (types.size > 1) {
      issues.push({
        code: "DUPLICATE_KEY_CONFLICT",
        severity: "error",
        message: `Multiple placeholders share key "${key}" with conflicting types.`,
      });
    }
  }

  // Slice count check
  const sliceCount = manifest.items.filter((i) => i.kind === "slice").length;
  if (sliceCount > opts.maxSliceCount) {
    issues.push({
      code: "SLICE_COUNT_HIGH",
      severity: "warning",
      message: `Flyer generated ${sliceCount} slices (exceeds recommended maximum of ${opts.maxSliceCount}). Consolidate decorative layers or minimize interleaving placeholders.`,
    });
  }

  // Budget check (preview tier total bytes)
  const previewBytes = manifest.tiers.preview.totalBytes;
  if (previewBytes > opts.maxPreviewBytesBudget) {
    const mb = (previewBytes / (1024 * 1024)).toFixed(2);
    const maxMb = (opts.maxPreviewBytesBudget / (1024 * 1024)).toFixed(1);
    issues.push({
      code: "OVER_BUDGET",
      severity: "warning",
      message: `Preview download size is ${mb} MB, exceeding the recommended ${maxMb} MB budget for fast mobile loading.`,
    });
  }

  // Missing fonts
  for (const f of manifest.fonts) {
    if (f.missing) {
      issues.push({
        code: "MISSING_FONTS",
        severity: "warning",
        message: `Font "${f.family}" was not found and may render using a system fallback.`,
      });
    }
  }

  // Fidelity score
  if (manifest.fidelity && manifest.fidelity.score < opts.minFidelityThreshold) {
    const pct = Math.round(manifest.fidelity.score * 100);
    const thresholdPct = Math.round(opts.minFidelityThreshold * 100);
    issues.push({
      code: "LOW_FIDELITY",
      severity: "warning",
      message: `Visual fidelity score is ${pct}% (below recommended ${thresholdPct}%). Check fidelity compare view for rendering discrepancies.`,
    });
  }

  return issues;
}
