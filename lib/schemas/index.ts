import { z } from "zod";
import { flyerManifestSchema } from "@/lib/flyer/types";

export const placeholderTypeSchema = z.enum(["text", "image"]);

export const placeholderOptionsSchema = z.object({
  maxLines: z.number().int().min(1).max(10).optional(),
  maxLength: z.number().int().min(1).max(500).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  minFontSize: z.number().min(4).max(200).optional(),
  maxFontSize: z.number().min(4).max(500).optional(),
  fallbackFont: z.string().optional(),
  fit: z.enum(["cover", "contain"]).optional(),
  useShapeAsMask: z.boolean().optional(),
  framingMode: z.enum(["face", "center", "custom"]).optional(),
  focalPoint: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const createEventSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  description: z.string().trim().max(1000).default(""),
  date: z.string().min(1, "Date is required"),
  venueName: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
  mapUrl: z.string().url().optional().or(z.literal("")),
  timeZone: z.string().default("UTC"),
  prefix: z.string().trim().min(1).default("#PLACEHOLDER_"),
  hashtag: z.string().trim().max(100).optional().or(z.literal("")),
  shareCaption: z.string().trim().max(500).optional().or(z.literal("")),
  dressCode: z.string().trim().max(100).optional().or(z.literal("")),
  contact: z.string().trim().max(200).optional().or(z.literal("")),
  closesAt: z.string().optional().nullable(),
  maxFlyers: z.number().int().positive().optional().nullable(),
});

export const updateEventSchema = createEventSchema.partial().extend({
  slug: z.string().trim().min(2).max(100).optional(),
});

export const boxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  xPx: z.number().optional(),
  yPx: z.number().optional(),
  wPx: z.number().optional(),
  hPx: z.number().optional(),
});

export const updatePlaceholderSchema = z.object({
  id: z.string().min(1),
  layerName: z.string().optional(),
  key: z.string().trim().min(1, "Key cannot be empty"),
  type: placeholderTypeSchema,
  sampleValue: z.string().optional(),
  box: boxSchema.optional(),
  options: placeholderOptionsSchema,
});

export const rescanPlaceholdersSchema = z.object({
  prefix: z.string().min(1),
});

export const createUploadUrlSchema = z.object({
  eventId: z.string().min(1),
  eventFormatId: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().default("image/vnd.adobe.photoshop"),
  sizeBytes: z.number().int().positive().max(150 * 1024 * 1024, "Max file size is 150MB"),
});

export const finalizeUploadSchema = z.object({
  eventId: z.string().min(1),
  eventFormatId: z.string().min(1),
  key: z.string().min(1),
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export const uploadPsdFromUrlSchema = z.object({
  eventId: z.string().min(1),
  eventFormatId: z.string().min(1),
  url: z.string().url("Enter a valid HTTP or HTTPS URL"),
});

export const createFontUploadUrlSchema = z.object({
  eventId: z.string().min(1),
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024, "Max font size is 25MB"),
});

export const finalizeFontUploadSchema = z.object({
  eventId: z.string().min(1),
  key: z.string().min(1),
  filename: z.string().min(1),
  family: z.string().optional(),
  weight: z.number().int().optional(),
  style: z.string().optional(),
});

export const allowedTrafficSources = [
  "whatsapp",
  "instagram",
  "x",
  "facebook",
  "direct",
  "other",
] as const;

export const trackAnalyticsSchema = z.object({
  type: z.enum(["visit", "form_started", "generated", "downloaded", "shared"]),
  format: z.string().max(50).optional(),
  source: z.string().max(50).optional(),
});

export const generationTokenRequestSchema = z.object({
  format: z.string().optional(),
});

export const reportGeneratedSchema = z.object({
  token: z.string().min(1),
  format: z.string().optional(),
});

export const createVersionSchema = z.object({
  eventId: z.string().min(1),
  formatId: z.string().min(1),
});

export const createAssetUploadUrlsSchema = z.object({
  versionId: z.string().min(1),
  assets: z
    .array(
      z.object({
        kind: z.enum(["slice", "mask"]),
        tier: z.enum(["preview", "full"]),
        sha256: z.string().length(64),
        bytes: z.number().int().positive().max(25 * 1024 * 1024, "Max asset size is 25MB"),
        contentType: z.enum(["image/png", "image/webp"]),
      })
    )
    .min(1)
    .max(60, "Maximum 60 assets allowed per version"),
});

export const createPsdBackupUploadUrlSchema = z.object({
  versionId: z.string().min(1),
  filename: z.string().min(1),
  sizeBytes: z.number().int().positive().max(150 * 1024 * 1024, "Max file size is 150MB"),
});

export const finalizePsdBackupUploadSchema = z.object({
  versionId: z.string().min(1),
  key: z.string().min(1),
});

export const commitVersionSchema = z.object({
  versionId: z.string().min(1),
  manifest: flyerManifestSchema,
});

export const restoreVersionSchema = z.object({
  eventId: z.string().min(1),
  formatId: z.string().min(1),
  versionId: z.string().min(1),
});

