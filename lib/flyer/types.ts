import { z } from "zod";

export const tierSchema = z.object({
  scale: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  totalBytes: z.number().int().nonnegative(),
});

export const assetRefSchema = z.object({
  key: z.string(),
  url: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().length(64),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  contentType: z.enum(["image/png", "image/webp"]),
});

export const placeholderBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

export const placeholderOptionsSchema = z.object({
  maxLines: z.number().int().positive().optional(),
  maxLength: z.number().int().positive().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  fontSize: z.number().positive().optional(),
  minFontSize: z.number().positive().optional(),
  maxFontSize: z.number().positive().optional(),
  fit: z.enum(["cover", "contain"]).optional(),
  useShapeAsMask: z.boolean().optional(),
  framingMode: z.enum(["center", "top-center", "face-aware", "focal"]).optional(),
  focalPoint: z.object({ x: z.number(), y: z.number() }).optional(),
  sampleValue: z.string().optional(),
  removeBackground: z.boolean().optional(),
  photoStyle: z.enum(["none", "flyer-match", "warm-cinema", "studio", "dramatic-bw"]).optional(),
  bottomFade: z.number().min(0).max(100).optional(),
  contrast: z.number().min(50).max(200).optional(),
  brightness: z.number().min(50).max(200).optional(),
  warmth: z.number().min(-100).max(100).optional(),
});

export const placeholderTextStyleSchema = z.object({
  fontFamily: z.string(),
  fontWeight: z.number().optional(),
  fontStyle: z.string().optional(),
  fontSize: z.number().positive(),
  color: z.string(),
  lineHeight: z.number().optional(),
  tracking: z.number().optional(),
  direction: z.enum(["ltr", "rtl"]).optional(),
});

export const manifestPlaceholderSchema = z.object({
  id: z.string(),
  key: z.string(),
  type: z.enum(["text", "image"]),
  layerName: z.string(),
  box: placeholderBoxSchema,
  options: placeholderOptionsSchema,
  textStyle: placeholderTextStyleSchema.optional(),
  mask: z
    .object({
      preview: assetRefSchema,
      full: assetRefSchema,
    })
    .optional(),
});

export const manifestFontSchema = z.object({
  family: z.string(),
  weight: z.number().optional(),
  style: z.string().optional(),
  url: z.string().optional(),
  missing: z.boolean(),
});

export const sliceItemSchema = z.object({
  kind: z.literal("slice"),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  assets: z.object({
    preview: assetRefSchema,
    full: assetRefSchema,
  }),
});

export const placeholderItemSchema = z.object({
  kind: z.literal("placeholder"),
  placeholderId: z.string(),
  inheritedOpacity: z.number().min(0).max(1).optional(),
});

export const manifestItemSchema = z.discriminatedUnion("kind", [
  sliceItemSchema,
  placeholderItemSchema,
]);

export const flyerFidelitySchema = z.object({
  score: z.number().min(0).max(1),
  method: z.literal("pixel-diff"),
  warnings: z.array(z.string()),
});

export const flyerGeneratorSchema = z.object({
  app: z.string(),
  psdLayerCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});

export const flyerManifestSchema = z.object({
  version: z.literal(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tiers: z.object({
    preview: tierSchema,
    full: tierSchema,
  }),
  items: z.array(manifestItemSchema),
  placeholders: z.array(manifestPlaceholderSchema),
  fonts: z.array(manifestFontSchema),
  fidelity: flyerFidelitySchema.optional(),
  generator: flyerGeneratorSchema,
});

export type Tier = z.infer<typeof tierSchema>;
export type AssetRef = z.infer<typeof assetRefSchema>;
export type PlaceholderBox = z.infer<typeof placeholderBoxSchema>;
export type PlaceholderOptions = z.infer<typeof placeholderOptionsSchema>;
export type PlaceholderTextStyle = z.infer<typeof placeholderTextStyleSchema>;
export type ManifestPlaceholder = z.infer<typeof manifestPlaceholderSchema>;
export type ManifestFont = z.infer<typeof manifestFontSchema>;
export type SliceItem = z.infer<typeof sliceItemSchema>;
export type PlaceholderItem = z.infer<typeof placeholderItemSchema>;
export type ManifestItem = z.infer<typeof manifestItemSchema>;
export type FlyerFidelity = z.infer<typeof flyerFidelitySchema>;
export type FlyerGenerator = z.infer<typeof flyerGeneratorSchema>;
export type FlyerManifest = z.infer<typeof flyerManifestSchema>;

export interface SlicedAsset {
  kind: "slice" | "mask";
  tier: "preview" | "full";
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  blob: Blob;
  contentType: "image/png" | "image/webp";
}

export interface SlicerResult {
  manifest: FlyerManifest;
  assets: SlicedAsset[];
  validationIssues: import("./validate").ValidationIssue[];
  previewUrl?: string;
  compositeBlob?: Blob;
}
