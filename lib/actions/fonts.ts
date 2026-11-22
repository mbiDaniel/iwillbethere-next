"use server";

import { db } from "@/lib/db";
import { fonts, psdVersions, eventFormats, validationIssues, placeholders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { ActionResult, requireEventOwner } from "./utils";
import { createFontUploadUrlSchema, finalizeFontUploadSchema } from "@/lib/schemas";
import { storage, verifyMagicBytes } from "@/lib/storage";
import { env } from "@/lib/env";
import { randomUUID } from "crypto";
import { validatePsd } from "@/lib/psd/validator";

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
