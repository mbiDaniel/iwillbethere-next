"use server";

import { db } from "@/lib/db";
import {
  events,
  eventFormats,
  psdVersions,
  placeholders,
  validationIssues,
  versionAssets,
} from "@/lib/db/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { ActionResult, requireEventOwner, requireUser } from "./utils";
import {
  createVersionSchema,
  createAssetUploadUrlsSchema,
  createPsdBackupUploadUrlSchema,
  finalizePsdBackupUploadSchema,
  commitVersionSchema,
  restoreVersionSchema,
  updatePlaceholderSchema,
  uploadPsdFromUrlSchema,
} from "@/lib/schemas";
import { storage, verifyMagicBytes } from "@/lib/storage";
import { env } from "@/lib/env";
import { randomUUID } from "crypto";
import { flyerManifestSchema, FlyerManifest } from "@/lib/flyer/types";
import { validateManifest } from "@/lib/flyer/validate";

/**
 * Checks PNG or WebP file signature.
 */
function verifyImageSignature(bytes: Buffer | Uint8Array, type: "image/png" | "image/webp"): boolean {
  if (type === "image/png") {
    if (bytes.length < 8) return false;
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (type === "image/webp") {
    if (bytes.length < 12) return false;
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
}

/**
 * 1. Creates a new psd_versions row in 'uploading' status with an incremented version number.
 */
export async function createVersion(
  input: unknown
): Promise<ActionResult<{ versionId: string; versionNumber: number }>> {
  try {
    const user = await requireUser();
    const parsed = createVersionSchema.parse(input);
    await requireEventOwner(parsed.eventId);

    const [format] = await db
      .select()
      .from(eventFormats)
      .where(and(eq(eventFormats.id, parsed.formatId), eq(eventFormats.eventId, parsed.eventId)));

    if (!format) {
      return { ok: false, error: "Event format not found." };
    }

    // Get current max version number
    const [latest] = await db
      .select({ version: psdVersions.version })
      .from(psdVersions)
      .where(eq(psdVersions.eventFormatId, parsed.formatId))
      .orderBy(desc(psdVersions.version))
      .limit(1);

    const nextVersionNumber = (latest?.version ?? 0) + 1;
    const versionId = randomUUID();

    await db.insert(psdVersions).values({
      id: versionId,
      eventFormatId: parsed.formatId,
      version: nextVersionNumber,
      status: "uploading",
      psdUploadStatus: "pending",
      sizeBytes: 0,
      createdAt: new Date(),
    });

    return { ok: true, data: { versionId, versionNumber: nextVersionNumber } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create version";
    return { ok: false, error: msg };
  }
}

/**
 * 2. Generates presigned PUT URLs for content-addressed slices and masks in R2 public bucket.
 */
export async function createAssetUploadUrls(
  input: unknown
): Promise<
  ActionResult<{
    uploadUrls: Array<{
      kind: "slice" | "mask";
      tier: "preview" | "full";
      sha256: string;
      key: string;
      uploadUrl: string;
      alreadyExists: boolean;
    }>;
  }>
> {
  try {
    await requireUser();
    const parsed = createAssetUploadUrlsSchema.parse(input);

    const [version] = await db
      .select({
        id: psdVersions.id,
        formatId: psdVersions.eventFormatId,
        eventId: eventFormats.eventId,
      })
      .from(psdVersions)
      .innerJoin(eventFormats, eq(eventFormats.id, psdVersions.eventFormatId))
      .where(eq(psdVersions.id, parsed.versionId));

    if (!version) {
      return { ok: false, error: "PSD version not found." };
    }

    await requireEventOwner(version.eventId);

    // Enforce limits: max total 150MB
    const totalBytes = parsed.assets.reduce((sum, a) => sum + a.bytes, 0);
    if (totalBytes > 150 * 1024 * 1024) {
      return { ok: false, error: "Total asset upload size exceeds 150 MB limit." };
    }

    const uploadUrls = [];

    for (const asset of parsed.assets) {
      const extension = asset.contentType === "image/webp" ? "webp" : "png";
      const folder = asset.kind === "slice" ? "slices" : "masks";
      const key = `events/${version.eventId}/versions/${version.id}/${folder}/${asset.sha256}.${extension}`;

      // Check if already in R2
      let alreadyExists = false;
      const head = await storage.headObject(env.R2_BUCKET_PUBLIC, key);
      if (head && head.contentLength === asset.bytes) {
        alreadyExists = true;
      }

      const uploadUrl = await storage.getSignedUploadUrl(
        env.R2_BUCKET_PUBLIC,
        key,
        asset.contentType,
        asset.bytes,
        900
      );

      uploadUrls.push({
        kind: asset.kind,
        tier: asset.tier,
        sha256: asset.sha256,
        key,
        uploadUrl,
        alreadyExists,
      });
    }

    return { ok: true, data: { uploadUrls } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create asset upload URLs";
    return { ok: false, error: msg };
  }
}

/**
 * 3. Generates presigned upload URL for the original PSD backup into the private bucket.
 */
export async function createPsdBackupUploadUrl(
  input: unknown
): Promise<ActionResult<{ uploadUrl: string; key: string }>> {
  try {
    await requireUser();
    const parsed = createPsdBackupUploadUrlSchema.parse(input);

    const [version] = await db
      .select({
        id: psdVersions.id,
        formatId: psdVersions.eventFormatId,
        eventId: eventFormats.eventId,
      })
      .from(psdVersions)
      .innerJoin(eventFormats, eq(eventFormats.id, psdVersions.eventFormatId))
      .where(eq(psdVersions.id, parsed.versionId));

    if (!version) {
      return { ok: false, error: "PSD version not found." };
    }

    await requireEventOwner(version.eventId);

    const key = `events/${version.eventId}/versions/${version.id}/backup.psd`;
    const uploadUrl = await storage.getSignedUploadUrl(
      env.R2_BUCKET_PRIVATE,
      key,
      "image/vnd.adobe.photoshop",
      parsed.sizeBytes,
      1800
    );

    return { ok: true, data: { uploadUrl, key } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create PSD backup URL";
    return { ok: false, error: msg };
  }
}

/**
 * Downloads a remote PSD from a URL, validates magic bytes, and stores in private bucket.
 */
export async function uploadPsdFromUrl(
  input: unknown
): Promise<ActionResult<{ versionId: string }>> {
  try {
    const parsed = uploadPsdFromUrlSchema.parse(input);

    const urlObj = new URL(parsed.url);
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return { ok: false, error: "Only HTTP and HTTPS URLs are supported." };
    }

    const hostname = urlObj.hostname.toLowerCase();
    if (
      hostname === "169.254.169.254" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local")
    ) {
      return {
        ok: false,
        error: "Access to private or internal addresses is blocked.",
      };
    }

    await requireEventOwner(parsed.eventId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

    let response: Response;
    try {
      response = await fetch(parsed.url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "IWillBeThere/1.0 (+https://iwillbethere.app)",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `Failed to download file from URL (${response.status}: ${response.statusText}).`,
      };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 150 * 1024 * 1024) {
      return {
        ok: false,
        error: "File is too large. Maximum supported PSD file size is 150MB.",
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return { ok: false, error: "Downloaded file is empty." };
    }

    const magicCheck = verifyMagicBytes(buffer, "psd");
    if (!magicCheck.valid) {
      return {
        ok: false,
        error: "Invalid file: The file downloaded from the link is not a valid Photoshop (.psd) document.",
      };
    }

    const key = `events/${parsed.eventId}/psds/${randomUUID()}.psd`;
    await storage.putObject(
      env.R2_BUCKET_PRIVATE,
      key,
      buffer,
      "image/vnd.adobe.photoshop"
    );

    const existingVersions = await db
      .select({ version: psdVersions.version })
      .from(psdVersions)
      .where(eq(psdVersions.eventFormatId, parsed.eventFormatId))
      .orderBy(desc(psdVersions.version))
      .limit(1);

    const nextVersionNumber = (existingVersions[0]?.version ?? 0) + 1;
    const versionId = randomUUID();

    await db.insert(psdVersions).values({
      id: versionId,
      eventFormatId: parsed.eventFormatId,
      version: nextVersionNumber,
      psdKey: key,
      psdUploadStatus: "uploaded",
      sizeBytes: buffer.length,
      width: 0,
      height: 0,
      status: "uploaded",
      createdAt: new Date(),
    });

    return { ok: true, data: { versionId } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to import PSD from URL";
    return { ok: false, error: msg };
  }
}

/**
 * 4. Finalizes background PSD backup upload.
 */
export async function finalizePsdBackupUpload(
  input: unknown
): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireUser();
    const parsed = finalizePsdBackupUploadSchema.parse(input);

    const [version] = await db
      .select({
        id: psdVersions.id,
        formatId: psdVersions.eventFormatId,
        eventId: eventFormats.eventId,
      })
      .from(psdVersions)
      .innerJoin(eventFormats, eq(eventFormats.id, psdVersions.eventFormatId))
      .where(eq(psdVersions.id, parsed.versionId));

    if (!version) {
      return { ok: false, error: "PSD version not found." };
    }

    await requireEventOwner(version.eventId);

    const head = await storage.headObject(env.R2_BUCKET_PRIVATE, parsed.key);
    if (!head || head.contentLength === 0) {
      await db
        .update(psdVersions)
        .set({ psdUploadStatus: "failed" })
        .where(eq(psdVersions.id, version.id));
      return { ok: false, error: "PSD backup file not found in storage." };
    }

    // Verify magic bytes
    const magicBytes = await storage.getRange(env.R2_BUCKET_PRIVATE, parsed.key, 0, 3);
    const magicCheck = verifyMagicBytes(magicBytes, "psd");
    if (!magicCheck.valid) {
      await storage.deleteObject(env.R2_BUCKET_PRIVATE, parsed.key);
      await db
        .update(psdVersions)
        .set({ psdUploadStatus: "failed" })
        .where(eq(psdVersions.id, version.id));
      return { ok: false, error: "Uploaded backup is not a valid Photoshop document." };
    }

    await db
      .update(psdVersions)
      .set({
        psdKey: parsed.key,
        psdUploadStatus: "uploaded",
        sizeBytes: head.contentLength,
      })
      .where(eq(psdVersions.id, version.id));

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to finalize PSD backup";
    return { ok: false, error: msg };
  }
}

/**
 * 5. Commits a sliced version with server-side validation, verification, and transaction writes.
 */
export async function commitVersion(
  input: unknown
): Promise<
  ActionResult<{
    versionId: string;
    manifestUrl: string;
    status: "ready";
    issues: import("@/lib/flyer/validate").ValidationIssue[];
  }>
> {
  try {
    await requireUser();
    const parsed = commitVersionSchema.parse(input);
    const manifest = parsed.manifest as FlyerManifest;

    const [version] = await db
      .select({
        id: psdVersions.id,
        formatId: psdVersions.eventFormatId,
        eventId: eventFormats.eventId,
      })
      .from(psdVersions)
      .innerJoin(eventFormats, eq(eventFormats.id, psdVersions.eventFormatId))
      .where(eq(psdVersions.id, parsed.versionId));

    if (!version) {
      return { ok: false, error: "PSD version not found." };
    }

    await requireEventOwner(version.eventId);

    // Sanity checks on manifest
    const manifestJson = JSON.stringify(manifest);
    if (Buffer.byteLength(manifestJson, "utf8") > 100 * 1024) {
      return { ok: false, error: "Manifest JSON exceeds maximum size limit (100 KB)." };
    }

    const versionPrefix = `events/${version.eventId}/versions/${version.id}/`;

    // Extract all referenced assets
    const referencedAssets: Array<{
      kind: "slice" | "mask";
      tier: "preview" | "full";
      assetRef: import("@/lib/flyer/types").AssetRef;
    }> = [];

    for (const item of manifest.items) {
      if (item.kind === "slice") {
        referencedAssets.push({ kind: "slice", tier: "preview", assetRef: item.assets.preview });
        referencedAssets.push({ kind: "slice", tier: "full", assetRef: item.assets.full });
      }
    }

    for (const p of manifest.placeholders) {
      if (p.mask) {
        referencedAssets.push({ kind: "mask", tier: "preview", assetRef: p.mask.preview });
        referencedAssets.push({ kind: "mask", tier: "full", assetRef: p.mask.full });
      }
    }

    // Verify each asset key and existence
    for (const { assetRef } of referencedAssets) {
      if (!assetRef.key.startsWith(versionPrefix)) {
        return {
          ok: false,
          error: `Asset key "${assetRef.key}" does not match version prefix "${versionPrefix}".`,
        };
      }

      const head = await storage.headObject(env.R2_BUCKET_PUBLIC, assetRef.key);
      if (!head) {
        return {
          ok: false,
          error: `Referenced asset "${assetRef.key}" was not found in storage.`,
        };
      }

      if (head.contentLength !== assetRef.bytes) {
        return {
          ok: false,
          error: `Asset size mismatch for "${assetRef.key}": expected ${assetRef.bytes} bytes, found ${head.contentLength}.`,
        };
      }

      // Spot-check image signature on first 12 bytes
      const firstBytes = await storage.getRange(env.R2_BUCKET_PUBLIC, assetRef.key, 0, 11);
      if (!verifyImageSignature(firstBytes, assetRef.contentType)) {
        return {
          ok: false,
          error: `Asset "${assetRef.key}" has invalid ${assetRef.contentType} signature.`,
        };
      }
    }

    // Server-side validation rules
    const serverIssues = validateManifest(manifest);
    const blockingErrors = serverIssues.filter((i) => i.severity === "error");
    if (blockingErrors.length > 0) {
      return {
        ok: false,
        error: `Validation failed: ${blockingErrors[0].message}`,
        issues: serverIssues,
      };
    }

    // Store manifest JSON in public bucket
    const manifestKey = `${versionPrefix}manifest.json`;
    await storage.putObject(
      env.R2_BUCKET_PUBLIC,
      manifestKey,
      Buffer.from(manifestJson, "utf8"),
      "application/json"
    );

    const firstSlice = manifest.items.find((i) => i.kind === "slice");
    const previewKey = firstSlice?.kind === "slice" ? firstSlice.assets.preview.key : null;

    // Single transaction write
    await db.transaction(async (tx) => {
      // 1. Delete any existing placeholders / validation issues / assets for this version
      await tx.delete(placeholders).where(eq(placeholders.psdVersionId, version.id));
      await tx.delete(validationIssues).where(eq(validationIssues.psdVersionId, version.id));
      await tx.delete(versionAssets).where(eq(versionAssets.psdVersionId, version.id));

      // 2. Insert placeholders
      for (const p of manifest.placeholders) {
        await tx.insert(placeholders).values({
          id: p.id,
          psdVersionId: version.id,
          layerId: `layer_${p.id}`,
          layerName: p.layerName,
          key: p.key,
          type: p.type,
          sampleValue: p.options.sampleValue,
          box: {
            x: Number(((p.box.x / manifest.width) * 100).toFixed(2)),
            y: Number(((p.box.y / manifest.height) * 100).toFixed(2)),
            w: Number(((p.box.w / manifest.width) * 100).toFixed(2)),
            h: Number(((p.box.h / manifest.height) * 100).toFixed(2)),
            xPx: p.box.x,
            yPx: p.box.y,
            wPx: p.box.w,
            hPx: p.box.h,
          },
          options: p.options,
          textStyle: p.textStyle,
          maskKey: p.mask?.full.key,
        });
      }

      // 3. Insert validation issues
      for (const iss of serverIssues) {
        await tx.insert(validationIssues).values({
          id: randomUUID(),
          psdVersionId: version.id,
          code: iss.code,
          severity: iss.severity,
          message: iss.message,
          layerName: iss.layerName,
          placeholderId: iss.placeholderId,
        });
      }

      // 4. Insert version assets
      for (const { kind, tier, assetRef } of referencedAssets) {
        await tx
          .insert(versionAssets)
          .values({
            id: randomUUID(),
            psdVersionId: version.id,
            kind,
            tier,
            key: assetRef.key,
            sha256: assetRef.sha256,
            bytes: assetRef.bytes,
            width: assetRef.width,
            height: assetRef.height,
            createdAt: new Date(),
          })
          .onConflictDoNothing();
      }

      // 5. Update psd_versions
      await tx
        .update(psdVersions)
        .set({
          status: "ready",
          manifestKey,
          previewKey,
          cleanPreviewKey: previewKey,
          width: manifest.width,
          height: manifest.height,
          sliceCount: manifest.items.filter((i) => i.kind === "slice").length,
          totalPreviewBytes: manifest.tiers.preview.totalBytes,
          totalFullBytes: manifest.tiers.full.totalBytes,
          fidelityScore: manifest.fidelity ? String(manifest.fidelity.score) : null,
          errorMessage: null,
        })
        .where(eq(psdVersions.id, version.id));
    });

    const manifestUrl = storage.getPublicUrl(manifestKey);
    return {
      ok: true,
      data: {
        versionId: version.id,
        manifestUrl,
        status: "ready",
        issues: serverIssues,
      },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to commit version";
    return { ok: false, error: msg };
  }
}

/**
 * 6. Generates a signed download URL to the stored PSD backup for re-scanning.
 */
export async function getRescanSignedUrl(
  eventId: string,
  formatId: string
): Promise<ActionResult<{ downloadUrl: string; key: string }>> {
  try {
    await requireUser();
    await requireEventOwner(eventId);

    const [latestUploaded] = await db
      .select({
        psdKey: psdVersions.psdKey,
        psdUploadStatus: psdVersions.psdUploadStatus,
      })
      .from(psdVersions)
      .where(
        and(
          eq(psdVersions.eventFormatId, formatId),
          eq(psdVersions.psdUploadStatus, "uploaded")
        )
      )
      .orderBy(desc(psdVersions.version))
      .limit(1);

    if (!latestUploaded?.psdKey) {
      return {
        ok: false,
        error: "No PSD backup found for this format. Please select your PSD file directly.",
      };
    }

    const downloadUrl = await storage.getSignedDownloadUrl(
      env.R2_BUCKET_PRIVATE,
      latestUploaded.psdKey,
      900
    );

    return { ok: true, data: { downloadUrl, key: latestUploaded.psdKey } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to generate PSD download URL";
    return { ok: false, error: msg };
  }
}

/**
 * 7. Restores an earlier ready version onto a format.
 */
export async function restoreVersion(
  input: unknown
): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireUser();
    const parsed = restoreVersionSchema.parse(input);
    await requireEventOwner(parsed.eventId);

    const [version] = await db
      .select()
      .from(psdVersions)
      .where(
        and(
          eq(psdVersions.id, parsed.versionId),
          eq(psdVersions.eventFormatId, parsed.formatId),
          eq(psdVersions.status, "ready")
        )
      );

    if (!version) {
      return { ok: false, error: "Target version is not ready or not found." };
    }

    await db
      .update(eventFormats)
      .set({ publishedVersionId: version.id })
      .where(eq(eventFormats.id, parsed.formatId));

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to restore version";
    return { ok: false, error: msg };
  }
}

/**
 * 8. Returns version history list for the event format.
 */
export async function getVersionList(
  eventId: string,
  formatId: string
): Promise<
  ActionResult<{
    versions: Array<{
      id: string;
      version: number;
      status: string;
      psdUploadStatus: string;
      sliceCount: number;
      totalPreviewBytes: number;
      totalFullBytes: number;
      fidelityScore: string | null;
      manifestKey: string | null;
      createdAt: string;
      isPublished: boolean;
    }>;
  }>
> {
  try {
    await requireUser();
    await requireEventOwner(eventId);

    const [format] = await db
      .select({ publishedVersionId: eventFormats.publishedVersionId })
      .from(eventFormats)
      .where(eq(eventFormats.id, formatId));

    const list = await db
      .select()
      .from(psdVersions)
      .where(eq(psdVersions.eventFormatId, formatId))
      .orderBy(desc(psdVersions.version));

    return {
      ok: true,
      data: {
        versions: list.map((v) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          psdUploadStatus: v.psdUploadStatus,
          sliceCount: v.sliceCount,
          totalPreviewBytes: v.totalPreviewBytes,
          totalFullBytes: v.totalFullBytes,
          fidelityScore: v.fidelityScore,
          manifestKey: v.manifestKey,
          createdAt: v.createdAt.toISOString(),
          isPublished: format?.publishedVersionId === v.id,
        })),
      },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to get version list";
    return { ok: false, error: msg };
  }
}

/**
 * 9. Deletes a version and cleans up orphan storage assets.
 */
export async function deleteVersion(
  eventId: string,
  formatId: string,
  versionId: string
): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireUser();
    await requireEventOwner(eventId);

    const [version] = await db
      .select()
      .from(psdVersions)
      .where(and(eq(psdVersions.id, versionId), eq(psdVersions.eventFormatId, formatId)));

    if (!version) {
      return { ok: false, error: "Version not found." };
    }

    // Get assets for this version
    const assets = await db
      .select()
      .from(versionAssets)
      .where(eq(versionAssets.psdVersionId, versionId));

    // Delete version row from DB (cascades versionAssets, placeholders, validationIssues)
    await db.delete(psdVersions).where(eq(psdVersions.id, versionId));

    // Delete R2 objects if no other version references the same sha256
    for (const a of assets) {
      const [otherRef] = await db
        .select({ id: versionAssets.id })
        .from(versionAssets)
        .where(eq(versionAssets.sha256, a.sha256))
        .limit(1);

      if (!otherRef) {
        await storage.deleteObject(env.R2_BUCKET_PUBLIC, a.key).catch(() => {});
      }
    }

    if (version.manifestKey) {
      await storage.deleteObject(env.R2_BUCKET_PUBLIC, version.manifestKey).catch(() => {});
    }
    if (version.psdKey) {
      await storage.deleteObject(env.R2_BUCKET_PRIVATE, version.psdKey).catch(() => {});
    }

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to delete version";
    return { ok: false, error: msg };
  }
}

/**
 * 10. Publishing, unpublishing, updating placeholders.
 */
export async function publishEvent(
  eventId: string
): Promise<ActionResult<{ published: boolean; issues?: any[] }>> {
  try {
    await requireEventOwner(eventId);

    const enabledFormats = await db
      .select()
      .from(eventFormats)
      .where(and(eq(eventFormats.eventId, eventId), eq(eventFormats.enabled, true)));

    if (enabledFormats.length === 0) {
      return { ok: false, error: "At least one format must be enabled before publishing." };
    }

    const blockingIssues: Array<{ format: string; code: string; message: string }> = [];
    const formatToVersionMap = new Map<string, string>();

    for (const fmt of enabledFormats) {
      const [latestVersion] = await db
        .select()
        .from(psdVersions)
        .where(eq(psdVersions.eventFormatId, fmt.id))
        .orderBy(desc(psdVersions.version))
        .limit(1);

      if (!latestVersion || latestVersion.status !== "ready") {
        blockingIssues.push({
          format: fmt.format,
          code: "VERSION_NOT_READY",
          message: `Format ${fmt.format} does not have a ready PSD version.`,
        });
        continue;
      }

      const errors = await db
        .select()
        .from(validationIssues)
        .where(
          and(
            eq(validationIssues.psdVersionId, latestVersion.id),
            eq(validationIssues.severity, "error")
          )
        );

      if (errors.length > 0) {
        for (const err of errors) {
          blockingIssues.push({
            format: fmt.format,
            code: err.code,
            message: err.message,
          });
        }
      }

      formatToVersionMap.set(fmt.id, latestVersion.id);
    }

    if (blockingIssues.length > 0) {
      return {
        ok: false,
        error: "Cannot publish: Validation errors must be resolved first.",
        issues: blockingIssues,
      };
    }

    // Single transaction: swap publishedVersionId pointers and mark published
    await db.transaction(async (tx) => {
      for (const [fmtId, verId] of formatToVersionMap.entries()) {
        await tx
          .update(eventFormats)
          .set({ publishedVersionId: verId })
          .where(eq(eventFormats.id, fmtId));
      }

      await tx
        .update(events)
        .set({ status: "published", updatedAt: new Date() })
        .where(eq(events.id, eventId));
    });

    return { ok: true, data: { published: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to publish event";
    return { ok: false, error: msg };
  }
}

export async function unpublishEvent(
  eventId: string
): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireEventOwner(eventId);
    await db
      .update(events)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(events.id, eventId));

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to unpublish event";
    return { ok: false, error: msg };
  }
}

export async function updatePlaceholder(
  eventId: string,
  input: unknown
): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireEventOwner(eventId);
    const parsed = updatePlaceholderSchema.parse(input);

    const updateData: any = {
      key: parsed.key,
      type: parsed.type,
      sampleValue: parsed.sampleValue,
      options: parsed.options,
    };
    if (parsed.box) {
      updateData.box = parsed.box;
    }

    await db
      .update(placeholders)
      .set(updateData)
      .where(eq(placeholders.id, parsed.id));

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to update placeholder";
    return { ok: false, error: msg };
  }
}

export async function saveAllPlaceholders(
  eventId: string,
  placeholdersList: Array<{
    id: string;
    layerName?: string;
    key: string;
    type: "text" | "image";
    sampleValue?: string;
    box?: { x: number; y: number; w: number; h: number };
    options: any;
  }>
): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireEventOwner(eventId);

    const formats = await db
      .select()
      .from(eventFormats)
      .where(eq(eventFormats.eventId, eventId));

    const format = formats[0];
    if (!format) return { ok: false, error: "Event format not found" };

    const [latestVersion] = await db
      .select()
      .from(psdVersions)
      .where(eq(psdVersions.eventFormatId, format.id))
      .orderBy(desc(psdVersions.version))
      .limit(1);

    if (!latestVersion) {
      return { ok: false, error: "No PSD version uploaded yet" };
    }

    const currentPlaceholders = await db
      .select()
      .from(placeholders)
      .where(eq(placeholders.psdVersionId, latestVersion.id));

    const currentMap = new Map(currentPlaceholders.map((p) => [p.id, p]));
    const incomingIds = new Set(placeholdersList.map((p) => p.id));

    // Delete placeholders removed
    for (const cur of currentPlaceholders) {
      if (!incomingIds.has(cur.id)) {
        await db.delete(placeholders).where(eq(placeholders.id, cur.id));
      }
    }

    // Update or insert
    for (let i = 0; i < placeholdersList.length; i++) {
      const p = placeholdersList[i];
      const existing = currentMap.get(p.id);

      const box = p.box || { x: 20, y: 30 + i * 15, w: 60, h: 12 };
      const options = p.options || {
        align: "center",
        maxLines: 1,
        maxLength: 100,
        fontSize: 36,
      };

      if (existing) {
        await db
          .update(placeholders)
          .set({
            key: p.key.trim(),
            type: p.type,
            sampleValue: p.sampleValue,
            box,
            options,
          })
          .where(eq(placeholders.id, p.id));
      } else {
        await db.insert(placeholders).values({
          id: p.id || randomUUID(),
          psdVersionId: latestVersion.id,
          layerId: `manual_${randomUUID().slice(0, 8)}`,
          layerName: p.layerName || `Placeholder (${p.key})`,
          key: p.key.trim(),
          type: p.type,
          sampleValue:
            p.sampleValue || (p.type === "image" ? "/jamie.png" : "Jamie Park"),
          box,
          options,
        });
      }
    }

    if (placeholdersList.length > 0) {
      await db
        .delete(validationIssues)
        .where(
          and(
            eq(validationIssues.psdVersionId, latestVersion.id),
            eq(validationIssues.code, "ZERO_PLACEHOLDERS")
          )
        );
    }

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to save placeholders";
    return { ok: false, error: msg };
  }
}

export async function setFormatEnabled(
  eventId: string,
  formatId: string,
  enabled: boolean
): Promise<ActionResult<{ success: boolean }>> {
  try {
    await requireEventOwner(eventId);
    await db
      .update(eventFormats)
      .set({ enabled })
      .where(and(eq(eventFormats.id, formatId), eq(eventFormats.eventId, eventId)));

    return { ok: true, data: { success: true } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to update format";
    return { ok: false, error: msg };
  }
}

export async function getProcessingStatus(
  psdVersionId: string
): Promise<
  ActionResult<{
    status: string;
    errorMessage?: string | null;
    width?: number;
    height?: number;
    manifestKey?: string | null;
    manifestUrl?: string | null;
    previewKey?: string | null;
    cleanPreviewKey?: string | null;
    sliceCount?: number;
    totalPreviewBytes?: number;
    totalFullBytes?: number;
    fidelityScore?: string | null;
    validationIssues: Array<{
      code: string;
      severity: "error" | "warning" | "passed";
      message: string;
      layerName?: string | null;
      placeholderId?: string | null;
    }>;
  }>
> {
  try {
    const [version] = await db
      .select()
      .from(psdVersions)
      .where(eq(psdVersions.id, psdVersionId));

    if (!version) {
      return { ok: false, error: "PSD version not found" };
    }

    const issues = await db
      .select()
      .from(validationIssues)
      .where(eq(validationIssues.psdVersionId, psdVersionId));

    const manifestUrl = version.manifestKey ? storage.getPublicUrl(version.manifestKey) : null;

    return {
      ok: true,
      data: {
        status: version.status,
        errorMessage: version.errorMessage,
        width: version.width,
        height: version.height,
        manifestKey: version.manifestKey,
        manifestUrl,
        previewKey: version.previewKey,
        cleanPreviewKey: version.cleanPreviewKey,
        sliceCount: version.sliceCount,
        totalPreviewBytes: version.totalPreviewBytes,
        totalFullBytes: version.totalFullBytes,
        fidelityScore: version.fidelityScore,
        validationIssues: issues as any,
      },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to get processing status";
    return { ok: false, error: msg };
  }
}
