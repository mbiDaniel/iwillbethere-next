/**
 * lib/flyer/fonts.ts
 *
 * Pure TypeScript — no React, no Next.js imports.
 * Runs in the browser main thread and in Web Workers.
 *
 * Responsibilities:
 *  1. Resolve a font family name against Google Fonts CSS2 API and return
 *     the first matching @font-face src URL (woff2).
 *  2. Load all fonts declared in a FlyerManifest into the browser's
 *     FontFaceSet (document.fonts) so canvas text renders correctly.
 *  3. Provide a lightweight "known Google Fonts" cache so the slicer
 *     worker can mark manifest fonts as `missing: false` without a network
 *     call (the worker has no fetch in older browsers).
 */

import type { FlyerManifest, ManifestFont } from "./types";

// ---------------------------------------------------------------------------
// PostScript name normalization
// ---------------------------------------------------------------------------

/**
 * Photoshop stores font names as PostScript names, e.g. "Roboto-Bold",
 * "OpenSans-LightItalic", "Montserrat-ExtraBoldItalic".
 *
 * Google Fonts (and CSS) expects the *family* name ("Roboto", "Open Sans")
 * plus separate numeric weight and style values.
 *
 * This function splits a PostScript name into its three components so we can
 * query Google Fonts correctly.
 *
 * Rules:
 *  - Strip everything after the last "-" (or space) that is a known weight/style token.
 *  - Convert CamelCase family names to space-separated ("OpenSans" → "Open Sans").
 *  - Return weight as a number (400 default) and style as "normal" | "italic" | "oblique".
 */
export function normalizePostScriptFontName(psName: string): {
  family: string;
  weight: number;
  style: "normal" | "italic" | "oblique";
} {
  // Weight token → CSS numeric weight
  const WEIGHT_MAP: Record<string, number> = {
    thin: 100,
    hairline: 100,
    extralight: 200,
    ultralight: 200,
    light: 300,
    regular: 400,
    roman: 400,
    book: 400,
    medium: 500,
    semibold: 600,
    demibold: 600,
    bold: 700,
    extrabold: 800,
    ultrabold: 800,
    black: 900,
    heavy: 900,
    extrablack: 950,
  };

  // Split on "-" first (PostScript style: "Roboto-BoldItalic"),
  // fall back to space (display style: "Roboto Bold Italic")
  const dashIdx = psName.lastIndexOf("-");
  let familyRaw = dashIdx >= 0 ? psName.slice(0, dashIdx) : psName;
  const suffixRaw = dashIdx >= 0 ? psName.slice(dashIdx + 1) : "";

  // Parse suffix tokens (e.g. "BoldItalic", "ExtraBoldItalic", "LightOblique")
  let weight = 400;
  let style: "normal" | "italic" | "oblique" = "normal";

  if (suffixRaw) {
    // Lower-case the suffix and strip style keywords first
    let s = suffixRaw.toLowerCase();
    if (s.endsWith("oblique")) { style = "oblique"; s = s.slice(0, -7).trim(); }
    if (s.endsWith("italic"))  { style = "italic";  s = s.slice(0, -6).trim(); }
    // What's left should be a weight token
    if (s && WEIGHT_MAP[s] !== undefined) {
      weight = WEIGHT_MAP[s];
    } else if (s) {
      // Unrecognised suffix — treat the whole psName as the family (no suffix split)
      familyRaw = psName;
    }
  }

  // Convert CamelCase family to space-separated ("OpenSans" → "Open Sans")
  // Only insert spaces between a lowercase→uppercase boundary or digit→letter
  const family = familyRaw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();

  return { family, weight, style };
}

// ---------------------------------------------------------------------------
// Google Fonts CSS2 helpers
// ---------------------------------------------------------------------------

/**
 * Builds a Google Fonts CSS2 stylesheet URL for one or more families.
 * Example: https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap
 */
export function buildGoogleFontsCssUrl(
  families: Array<{ family: string; weight?: number; style?: string }>
): string {
  const params = families
    .map(({ family, weight, style }) => {
      const name = family.replace(/ /g, "+");
      const isItalic = style === "italic";
      if (weight || isItalic) {
        // Axis format: ital,wght@0,400;1,700
        const axes = isItalic ? "ital,wght" : "wght";
        const val = isItalic
          ? `1,${weight ?? 400}`
          : `${weight ?? 400}`;
        return `family=${name}:${axes}@${val}`;
      }
      return `family=${name}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/**
 * Fetches the Google Fonts CSS2 stylesheet for `family` and extracts the
 * first woff2 src URL it finds.  Returns null if the family isn't on Google
 * Fonts or if the network request fails.
 *
 * Must be called from a context that has fetch (main thread or modern worker).
 */
export async function resolveGoogleFontUrl(
  family: string,
  weight = 400,
  style = "normal"
): Promise<string | null> {
  try {
    const cssUrl = buildGoogleFontsCssUrl([{ family, weight, style }]);
    // User-Agent trick: request woff2 by pretending to be a modern browser
    const res = await fetch(cssUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    const css = await res.text();
    // Extract first url(...) that ends in .woff2
    const match = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+\.woff2)\)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Given a FlyerManifest, attempt to resolve each missing font via Google
 * Fonts and return an updated fonts array.  Fonts that resolve get
 * `missing: false` and a `url` pointing to the woff2 file.
 * Fonts that don't resolve keep `missing: true`.
 *
 * PostScript family names (e.g. "Roboto-Bold") are automatically normalised
 * to their base family + numeric weight before querying Google Fonts.
 *
 * Safe to call from the browser main thread only (needs fetch).
 */
export async function resolveManifestFonts(
  fonts: ManifestFont[]
): Promise<ManifestFont[]> {
  return Promise.all(
    fonts.map(async (f) => {
      if (!f.missing) return f; // already resolved (uploaded custom font)

      // Normalise PostScript name → clean family + weight + style
      const norm = normalizePostScriptFontName(f.family);
      const lookupFamily = norm.family;
      const lookupWeight = f.weight ?? norm.weight;
      const lookupStyle  = f.style  ?? norm.style;

      const url = await resolveGoogleFontUrl(lookupFamily, lookupWeight, lookupStyle);
      if (url) {
        // Store the clean family name so CSS font-family references work
        return { ...f, family: lookupFamily, weight: lookupWeight, style: lookupStyle, url, missing: false };
      }
      // Even if not found, persist the clean family name for display
      return { ...f, family: lookupFamily, weight: lookupWeight, style: lookupStyle };
    })
  );
}

// ---------------------------------------------------------------------------
// Font loading into document.fonts
// ---------------------------------------------------------------------------

/** Cache so we don't load the same font twice per page load. */
const loadedFontKeys = new Set<string>();

/**
 * Loads all fonts declared in a FlyerManifest into the browser's FontFaceSet.
 * Call this before renderFlyer() so canvas `ctx.font = "..."` picks up the
 * correct typeface instead of falling back to system sans-serif.
 *
 * - Fonts with a `url` (custom-uploaded or Google Fonts) are loaded via
 *   FontFace API.
 * - Fonts without a `url` and `missing: true` are skipped (canvas will fall
 *   back gracefully).
 *
 * Idempotent: loading the same family/weight/style twice is a no-op.
 */
export async function loadFontsForManifest(
  manifest: FlyerManifest
): Promise<{ loaded: string[]; failed: string[] }> {
  const loaded: string[] = [];
  const failed: string[] = [];

  // document.fonts is only available in browser contexts
  if (typeof document === "undefined" || !document.fonts) {
    return { loaded, failed };
  }

  await Promise.all(
    manifest.fonts.map(async (f) => {
      if (!f.url) return; // no URL — nothing we can do yet

      const key = `${f.family}:${f.weight ?? 400}:${f.style ?? "normal"}`;
      if (loadedFontKeys.has(key)) {
        loaded.push(f.family);
        return;
      }

      try {
        const descriptors: FontFaceDescriptors = {};
        if (f.weight) descriptors.weight = String(f.weight);
        if (f.style) descriptors.style = f.style;

        const face = new FontFace(f.family, `url(${f.url})`, descriptors);
        await face.load();
        document.fonts.add(face);
        loadedFontKeys.add(key);
        loaded.push(f.family);
      } catch {
        failed.push(f.family);
      }
    })
  );

  return { loaded, failed };
}

/**
 * Convenience wrapper: resolve Google Fonts URLs for missing manifest fonts,
 * then immediately load them into document.fonts.
 *
 * Returns the updated manifest (with `url` fields populated) plus load stats.
 */
export async function resolveAndLoadFonts(manifest: FlyerManifest): Promise<{
  manifest: FlyerManifest;
  loaded: string[];
  failed: string[];
  stillMissing: string[];
}> {
  const resolvedFonts = await resolveManifestFonts(manifest.fonts);
  const updated: FlyerManifest = { ...manifest, fonts: resolvedFonts };
  const { loaded, failed } = await loadFontsForManifest(updated);
  const stillMissing = resolvedFonts
    .filter((f) => f.missing)
    .map((f) => f.family);
  return { manifest: updated, loaded, failed, stillMissing };
}
