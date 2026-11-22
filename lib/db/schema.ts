import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

// ----------------------------------------------------
// Enums
// ----------------------------------------------------
export const eventStatusEnum = pgEnum("event_status", [
  "draft",
  "published",
  "archived",
]);

export const eventFormatEnum = pgEnum("event_format", [
  "square",
  "story",
  "portrait",
  "original",
]);

export const psdVersionStatusEnum = pgEnum("psd_version_status", [
  "uploading",
  "uploaded",
  "processing",
  "ready",
  "failed",
]);

export const psdUploadStatusEnum = pgEnum("psd_upload_status", [
  "pending",
  "uploaded",
  "failed",
]);

export const assetKindEnum = pgEnum("asset_kind", ["slice", "mask"]);
export const assetTierEnum = pgEnum("asset_tier", ["preview", "full"]);

export const placeholderTypeEnum = pgEnum("placeholder_type", [
  "text",
  "image",
]);

export const validationSeverityEnum = pgEnum("validation_severity", [
  "error",
  "warning",
  "passed",
]);

export const analyticsEventTypeEnum = pgEnum("analytics_event_type", [
  "visit",
  "form_started",
  "generated",
  "downloaded",
  "shared",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

// ----------------------------------------------------
// Better Auth Tables
// ----------------------------------------------------
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ----------------------------------------------------
// Application Tables
// ----------------------------------------------------
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: eventStatusEnum("status").notNull().default("draft"),
    prefix: text("prefix").notNull().default("#PLACEHOLDER_"),
    hashtag: text("hashtag"),
    shareCaption: text("share_caption"),
    venueName: text("venue_name"),
    address: text("address"),
    mapUrl: text("map_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    timeZone: text("time_zone").notNull().default("UTC"),
    schedule: jsonb("schedule"),
    dressCode: text("dress_code"),
    contact: text("contact"),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    maxFlyers: integer("max_flyers"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("events_owner_id_idx").on(table.ownerId),
    uniqueIndex("events_slug_idx").on(table.slug),
    index("events_active_idx")
      .on(table.deletedAt)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);

export const eventFormats = pgTable(
  "event_formats",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    format: eventFormatEnum("format").notNull().default("square"),
    enabled: boolean("enabled").notNull().default(true),
    publishedVersionId: text("published_version_id"),
  },
  (table) => [
    index("event_formats_event_id_idx").on(table.eventId),
  ]
);

export const psdVersions = pgTable(
  "psd_versions",
  {
    id: text("id").primaryKey(),
    eventFormatId: text("event_format_id")
      .notNull()
      .references(() => eventFormats.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    psdKey: text("psd_key"),
    psdUploadStatus: psdUploadStatusEnum("psd_upload_status").notNull().default("pending"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    status: psdVersionStatusEnum("status").notNull().default("uploading"),
    errorMessage: text("error_message"),
    manifestKey: text("manifest_key"),
    previewKey: text("preview_key"),
    cleanPreviewKey: text("clean_preview_key"),
    sliceCount: integer("slice_count").notNull().default(0),
    totalPreviewBytes: integer("total_preview_bytes").notNull().default(0),
    totalFullBytes: bigint("total_full_bytes", { mode: "number" }).notNull().default(0),
    fidelityScore: text("fidelity_score"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("psd_versions_format_id_idx").on(table.eventFormatId),
  ]
);

export const versionAssets = pgTable(
  "version_assets",
  {
    id: text("id").primaryKey(),
    psdVersionId: text("psd_version_id")
      .notNull()
      .references(() => psdVersions.id, { onDelete: "cascade" }),
    kind: assetKindEnum("kind").notNull(),
    tier: assetTierEnum("tier").notNull(),
    key: text("key").notNull(),
    sha256: text("sha256").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("version_assets_version_id_idx").on(table.psdVersionId),
    uniqueIndex("version_assets_unique_idx").on(
      table.psdVersionId,
      table.sha256,
      table.tier,
      table.kind
    ),
  ]
);

export const placeholders = pgTable(
  "placeholders",
  {
    id: text("id").primaryKey(),
    psdVersionId: text("psd_version_id")
      .notNull()
      .references(() => psdVersions.id, { onDelete: "cascade" }),
    layerId: text("layer_id").notNull(),
    layerName: text("layer_name").notNull(),
    key: text("key").notNull(),
    type: placeholderTypeEnum("type").notNull().default("text"),
    sampleValue: text("sample_value"),
    box: jsonb("box").$type<{
      x: number;
      y: number;
      w: number;
      h: number;
      xPx?: number;
      yPx?: number;
      wPx?: number;
      hPx?: number;
    }>().notNull(),
    options: jsonb("options").$type<{
      maxLines?: number;
      maxLength?: number;
      align?: "left" | "center" | "right";
      minFontSize?: number;
      maxFontSize?: number;
      fallbackFont?: string;
      fit?: "cover" | "contain";
      useShapeAsMask?: boolean;
      framingMode?: "center" | "top-center" | "face-aware" | "focal" | "face" | "custom";
      focalPoint?: { x: number; y: number };
    }>().notNull(),
    textStyle: jsonb("text_style").$type<{
      fontFamily?: string;
      fontSize?: number;
      color?: string;
      align?: string;
      lineHeight?: number;
      tracking?: number;
    }>(),
    maskKey: text("mask_key"),
  },
  (table) => [
    index("placeholders_version_id_idx").on(table.psdVersionId),
  ]
);

export const fonts = pgTable(
  "fonts",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    family: text("family").notNull(),
    weight: integer("weight"),
    style: text("style"),
    fileKey: text("file_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fonts_event_id_idx").on(table.eventId),
  ]
);

export const validationIssues = pgTable(
  "validation_issues",
  {
    id: text("id").primaryKey(),
    psdVersionId: text("psd_version_id")
      .notNull()
      .references(() => psdVersions.id, { onDelete: "cascade" }),
    severity: validationSeverityEnum("severity").notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    layerName: text("layer_name"),
    placeholderId: text("placeholder_id"),
  },
  (table) => [
    index("validation_issues_version_id_idx").on(table.psdVersionId),
  ]
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    type: analyticsEventTypeEnum("type").notNull(),
    format: text("format"),
    source: text("source"),
    visitorHash: text("visitor_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("analytics_event_id_created_idx").on(table.eventId, table.createdAt),
    index("analytics_event_id_type_idx").on(table.eventId, table.type),
  ]
);

export const generationTokens = pgTable(
  "generation_tokens",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    index("generation_tokens_event_id_idx").on(table.eventId),
  ]
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("jobs_status_run_at_idx").on(table.status, table.runAt),
  ]
);

// ----------------------------------------------------
// Relations
// ----------------------------------------------------
export const userRelations = relations(user, ({ many }) => ({
  events: many(events),
  sessions: many(session),
  accounts: many(account),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  owner: one(user, {
    fields: [events.ownerId],
    references: [user.id],
  }),
  formats: many(eventFormats),
  fonts: many(fonts),
  analytics: many(analyticsEvents),
  tokens: many(generationTokens),
}));

export const eventFormatsRelations = relations(eventFormats, ({ one, many }) => ({
  event: one(events, {
    fields: [eventFormats.eventId],
    references: [events.id],
  }),
  versions: many(psdVersions),
}));

export const psdVersionsRelations = relations(psdVersions, ({ one, many }) => ({
  format: one(eventFormats, {
    fields: [psdVersions.eventFormatId],
    references: [eventFormats.id],
  }),
  placeholders: many(placeholders),
  validationIssues: many(validationIssues),
  assets: many(versionAssets),
}));

export const versionAssetsRelations = relations(versionAssets, ({ one }) => ({
  version: one(psdVersions, {
    fields: [versionAssets.psdVersionId],
    references: [psdVersions.id],
  }),
}));

export const placeholdersRelations = relations(placeholders, ({ one }) => ({
  version: one(psdVersions, {
    fields: [placeholders.psdVersionId],
    references: [psdVersions.id],
  }),
}));

export const validationIssuesRelations = relations(validationIssues, ({ one }) => ({
  version: one(psdVersions, {
    fields: [validationIssues.psdVersionId],
    references: [psdVersions.id],
  }),
}));
