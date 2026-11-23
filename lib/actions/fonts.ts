"use server";

import { db } from "@/lib/db";
import { fonts, psdVersions, eventFormats, validationIssues, placeholders } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { ActionResult, requireEventOwner } from "./utils";
import { createFontUploadUrlSchema, finalizeFontUploadSchema } from "@/lib/schemas";
import { storage, verifyMagicBytes } from "@/lib/storage";
import { env } from "@/lib/env";
import { randomUUID } from "crypto";
import { validatePsd } from "@/lib/psd/validator";
import { buildGoogleFontsCssUrl, normalizePostScriptFontName } from "@/lib/flyer/fonts";

export async function createFontUploadUrl(
  input: unknown
): Promise<ActionResult<{ uploadUrl: string; key: string }>> {
  try {
    const parsed = createFontUploadUrlSchema.parse(input);
    await requireEventOwner(parsed.eventId);

    const ext = parsed.filename.split(".").pop() || "otf";
    const key = `events/${parsed.eventId}/fonts/${randomUUID()}.${ext}`;

    const uploadUrl = await storage.getSignedUploadUrl(
      env.R2_BUCKET_PUBLIC,
      key,
      "font/otf",
      parsed.sizeBytes,
      900
    );

    return { ok: true, data: { uploadUrl, key } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create font upload URL";
    return { ok: false, error: msg };
  }
}

export async function finalizeFontUpload(
  input: unknown
): Promise<ActionResult<{ fontId: string }>> {
  try {
    const parsed = finalizeFontUploadSchema.parse(input);
    await requireEventOwner(parsed.eventId);

    const head = await storage.headObject(env.R2_BUCKET_PUBLIC, parsed.key);
    if (!head || head.contentLength === 0) {
      return { ok: false, error: "Uploaded font not found or empty." };
    }

    const firstBytes = await storage.getRange(env.R2_BUCKET_PUBLIC, parsed.key, 0, 3);
    const magicCheck = verifyMagicBytes(firstBytes, "font");

    if (!magicCheck.valid) {
      await storage.deleteObject(env.R2_BUCKET_PUBLIC, parsed.key);
      return {
        ok: false,
        error: "Invalid font file: Must be a valid TTF, OTF, WOFF, or WOFF2 font.",
      };
    }

    const fontId = randomUUID();
    const family =
      parsed.family || parsed.filename.replace(/\.[^.]+$/, "");

    await db.insert(fonts).values({
      id: fontId,
      eventId: parsed.eventId,
      family,
      weight: parsed.weight ?? 400,
      style: parsed.style ?? "normal",
      fileKey: parsed.key,
      createdAt: new Date(),
    });

    // Update manifest in storage with the uploaded font URL
    const publicUrl = `/api/public/assets/${parsed.key}`;
    await updateEventManifestFont(parsed.eventId, {
      family,
      weight: parsed.weight ?? 400,
      style: parsed.style ?? "normal",
      url: publicUrl,
    });

    // Re-run validation on all versions of this event
    await revalidateEventVersions(parsed.eventId);

    return { ok: true, data: { fontId } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to finalize font upload";
    return { ok: false, error: msg };
  }
}

export async function deleteFont(
  eventId: string,
  fontId: string
): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireEventOwner(eventId);

    const [font] = await db
      .select()
      .from(fonts)
      .where(and(eq(fonts.id, fontId), eq(fonts.eventId, eventId)));

    if (font) {
      await storage.deleteObject(env.R2_BUCKET_PUBLIC, font.fileKey);
      await db.delete(fonts).where(eq(fonts.id, fontId));
      await revalidateEventVersions(eventId);
    }

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to delete font";
    return { ok: false, error: msg };
  }
}

async function updateEventManifestFont(
  eventId: string,
  fontData: { family: string; weight?: number; style?: string; url: string }
) {
  try {
    const formats = await db
      .select()
      .from(eventFormats)
      .where(eq(eventFormats.eventId, eventId));

    for (const fmt of formats) {
      const [ver] = await db
        .select()
        .from(psdVersions)
        .where(eq(psdVersions.eventFormatId, fmt.id))
        .orderBy(desc(psdVersions.version))
        .limit(1);

      if (ver && ver.manifestKey) {
        const manifestBuf = await storage.getObject(env.R2_BUCKET_PUBLIC, ver.manifestKey).catch(() => null);
        if (manifestBuf) {
          const manifest = JSON.parse(manifestBuf.toString("utf8"));
          if (Array.isArray(manifest.fonts)) {
            let matched = false;
            const normTarget = normalizePostScriptFontName(fontData.family);
            manifest.fonts = manifest.fonts.map((f: any) => {
              const normF = normalizePostScriptFontName(f.family);
              if (
                normF.family.toLowerCase() === normTarget.family.toLowerCase() ||
                f.family.toLowerCase() === fontData.family.toLowerCase()
              ) {
                matched = true;
                return {
                  ...f,
                  family: fontData.family,
                  weight: fontData.weight ?? f.weight ?? 400,
                  style: fontData.style ?? f.style ?? "normal",
                  url: fontData.url,
                  missing: false,
                };
              }
              return f;
            });

            if (!matched) {
              manifest.fonts.push({
                family: fontData.family,
                weight: fontData.weight ?? 400,
                style: fontData.style ?? "normal",
                url: fontData.url,
                missing: false,
              });
            }

            // Also update any placeholders that reference this font family
            for (const p of manifest.placeholders || []) {
              if (p.textStyle?.fontFamily) {
                const normP = normalizePostScriptFontName(p.textStyle.fontFamily);
                if (
                  normP.family.toLowerCase() === normTarget.family.toLowerCase() ||
                  p.textStyle.fontFamily.toLowerCase() === fontData.family.toLowerCase()
                ) {
                  p.textStyle.fontFamily = fontData.family;
                }
              }
            }

            await storage.putObject(
              env.R2_BUCKET_PUBLIC,
              ver.manifestKey,
              Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
              "application/json"
            );
          }
        }
      }
    }
  } catch (err) {
    console.warn("Failed to update manifest in storage:", err);
  }
}

/**
 * Resolves a font family name against Google Fonts CSS2 endpoint and returns the woff2 URL.
 */
export async function resolveGoogleFont(input: {
  family: string;
  weight?: number;
  style?: string;
}): Promise<ActionResult<{ url: string; family: string; weight: number; style: string }>> {
  try {
    const norm = normalizePostScriptFontName(input.family);
    const lookupFamily = norm.family;
    const lookupWeight = input.weight ?? norm.weight ?? 400;
    const lookupStyle = input.style ?? norm.style ?? "normal";

    // 1. Try with specific weight/style
    let cssUrl = buildGoogleFontsCssUrl([
      { family: lookupFamily, weight: lookupWeight, style: lookupStyle },
    ]);

    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    let res = await fetch(cssUrl, { headers }).catch(() => null);

    // 2. If specific weight fails, try default family
    if (!res || !res.ok) {
      cssUrl = `https://fonts.googleapis.com/css2?family=${lookupFamily.replace(/ /g, "+")}&display=swap`;
      res = await fetch(cssUrl, { headers }).catch(() => null);
    }

    if (!res || !res.ok) {
      return { ok: false, error: `Font "${lookupFamily}" not found on Google Fonts.` };
    }

    const css = await res.text();
    const match = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+\.woff2)\)/);

    if (!match) {
      return { ok: false, error: `Could not extract WOFF2 font file for "${lookupFamily}".` };
    }

    return {
      ok: true,
      data: {
        url: match[1],
        family: lookupFamily,
        weight: lookupWeight,
        style: lookupStyle,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Google Fonts lookup failed";
    return { ok: false, error: msg };
  }
}

/**
 * Permanently saves a resolved font (Google Font or uploaded) to the event
 * and updates the active version's manifest.json in R2 storage.
 */
export async function saveResolvedFont(input: {
  eventId: string;
  family: string;
  weight?: number;
  style?: string;
  url: string;
  fileKey?: string;
}): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireEventOwner(input.eventId);

    const norm = normalizePostScriptFontName(input.family);
    const cleanFamily = norm.family;
    const weight = input.weight ?? norm.weight ?? 400;
    const style = input.style ?? norm.style ?? "normal";

    // Insert font into database
    await db.insert(fonts).values({
      id: randomUUID(),
      eventId: input.eventId,
      family: cleanFamily,
      weight,
      style,
      fileKey: input.fileKey ?? `google:${cleanFamily}`,
      createdAt: new Date(),
    });

    // Update manifest.json in storage for this event
    await updateEventManifestFont(input.eventId, {
      family: cleanFamily,
      weight,
      style,
      url: input.url,
    });

    // Revalidate event version issues
    await revalidateEventVersions(input.eventId);

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to save resolved font";
    return { ok: false, error: msg };
  }
}

async function revalidateEventVersions(eventId: string) {
  const allFonts = await db.select().from(fonts).where(eq(fonts.eventId, eventId));
  const fontNames = allFonts.map((f) => f.family);

  const formats = await db
    .select()
    .from(eventFormats)
    .where(eq(eventFormats.eventId, eventId));

  for (const fmt of formats) {
    const versions = await db
      .select()
      .from(psdVersions)
      .where(eq(psdVersions.eventFormatId, fmt.id));

    for (const ver of versions) {
      if (ver.status !== "ready") continue;

      const pList = await db
        .select()
        .from(placeholders)
        .where(eq(placeholders.psdVersionId, ver.id));

      const issues = validatePsd(pList as any, [], fontNames);

      await db.transaction(async (tx) => {
        await tx
          .delete(validationIssues)
          .where(eq(validationIssues.psdVersionId, ver.id));

        if (issues.length > 0) {
          await tx.insert(validationIssues).values(
            issues.map((i) => ({
              id: randomUUID(),
              psdVersionId: ver.id,
              severity: i.severity,
              code: i.code,
              message: i.message,
              layerName: i.layerName,
              placeholderId: i.placeholderId,
            }))
          );
        }
      });
    }
  }
}
