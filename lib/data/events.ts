import "server-only";

import { db } from "@/lib/db";
import {
  events,
  eventFormats,
  psdVersions,
  placeholders,
  fonts,
  analyticsEvents,
  validationIssues,
} from "@/lib/db/schema";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";
import type { Event, Placeholder } from "@/lib/types";

export async function getPublishedEventBySlug(slug: string): Promise<Event | null> {
  const [row] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.slug, slug),
        eq(events.status, "published"),
        isNull(events.deletedAt)
      )
    );

  if (!row) return null;

  // Find primary enabled format
  const [format] = await db
    .select()
    .from(eventFormats)
    .where(and(eq(eventFormats.eventId, row.id), eq(eventFormats.enabled, true)));

  let artwork = "/open-studio.svg";
  let placeholderList: Placeholder[] = [];
  let manifestUrl: string | null = null;
  let manifestKey: string | null = null;

  if (format?.publishedVersionId) {
    const [version] = await db
      .select()
      .from(psdVersions)
      .where(eq(psdVersions.id, format.publishedVersionId));

    if (version?.manifestKey) {
      manifestKey = version.manifestKey;
      manifestUrl = storage.getPublicUrl(version.manifestKey);
    }

    if (version?.cleanPreviewKey) {
      artwork = storage.getPublicUrl(version.cleanPreviewKey);
    } else if (version?.previewKey) {
      artwork = storage.getPublicUrl(version.previewKey);
    }

    if (version) {
      const dbPlaceholders = await db
        .select()
        .from(placeholders)
        .where(eq(placeholders.psdVersionId, version.id));

      placeholderList = dbPlaceholders.map((p) => ({
        id: p.id,
        layerName: p.layerName,
        key: p.key,
        type: p.type as "text" | "image",
        sampleValue: p.sampleValue || undefined,
        box: {
          x: p.box.x,
          y: p.box.y,
          w: p.box.w,
          h: p.box.h,
        },
        options: p.options,
      }));
    }
  }

  const [genCount] = await db
    .select({ value: count() })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.eventId, row.id),
        eq(analyticsEvents.type, "generated")
      )
    );

  const eventFonts = await db
    .select()
    .from(fonts)
    .where(eq(fonts.eventId, row.id));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    date: row.startsAt ? row.startsAt.toISOString().slice(0, 16) : "",
    description: row.description,
    artwork,
    status: "Published",
    count: genCount?.value ?? 0,
    placeholders: placeholderList,
    fonts: eventFonts.map((f) => ({ name: f.family, status: "Uploaded" })),
    manifestUrl,
    manifestKey,
  };
}

export async function getUserEvents(userId: string): Promise<Event[]> {
  const userEvents = await db
    .select()
    .from(events)
    .where(and(eq(events.ownerId, userId), isNull(events.deletedAt)))
    .orderBy(desc(events.createdAt));

  const results: Event[] = [];

  for (const e of userEvents) {
    const [genCount] = await db
      .select({ value: count() })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventId, e.id),
          eq(analyticsEvents.type, "generated")
        )
      );

    const [fmt] = await db
      .select()
      .from(eventFormats)
      .where(eq(eventFormats.eventId, e.id));

    let artwork = "/open-studio.svg";
    let pList: Placeholder[] = [];

    if (fmt) {
      const [latestVersion] = await db
        .select()
        .from(psdVersions)
        .where(eq(psdVersions.eventFormatId, fmt.id))
        .orderBy(desc(psdVersions.version))
        .limit(1);

      if (latestVersion?.previewKey) {
        artwork = storage.getPublicUrl(latestVersion.previewKey);
      }

      if (latestVersion) {
        const dbPlaceholders = await db
          .select()
          .from(placeholders)
          .where(eq(placeholders.psdVersionId, latestVersion.id));

        pList = dbPlaceholders.map((p) => ({
          id: p.id,
          layerName: p.layerName,
          key: p.key,
          type: p.type as "text" | "image",
          sampleValue: p.sampleValue || undefined,
          box: {
            x: p.box.x,
            y: p.box.y,
            w: p.box.w,
            h: p.box.h,
          },
          options: p.options,
        }));
      }
    }

    const eventFonts = await db
      .select()
      .from(fonts)
      .where(eq(fonts.eventId, e.id));

    results.push({
      id: e.id,
      slug: e.slug,
      title: e.title,
      date: e.startsAt ? e.startsAt.toISOString().slice(0, 16) : "",
      description: e.description,
      artwork,
      status: e.status === "published" ? "Published" : "Draft",
      count: genCount?.value ?? 0,
      placeholders: pList,
      fonts: eventFonts.map((f) => ({ name: f.family, status: "Uploaded" })),
    });
  }

  return results;
}

export async function getUserEventById(
  userId: string,
  eventId: string
): Promise<(Event & { formatId?: string; validationIssues?: any[] }) | null> {
  const [e] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.ownerId, userId),
        isNull(events.deletedAt)
      )
    );

  if (!e) return null;

  const [fmt] = await db
    .select()
    .from(eventFormats)
    .where(eq(eventFormats.eventId, e.id));

  let artwork = "/open-studio.svg";
  let pList: Placeholder[] = [];
  let issues: any[] = [];
  let manifestUrl: string | null = null;
  let manifestKey: string | null = null;

  if (fmt) {
    const [latestVersion] = await db
      .select()
      .from(psdVersions)
      .where(eq(psdVersions.eventFormatId, fmt.id))
      .orderBy(desc(psdVersions.version))
      .limit(1);

    if (latestVersion?.manifestKey) {
      manifestKey = latestVersion.manifestKey;
      manifestUrl = storage.getPublicUrl(latestVersion.manifestKey);
    }

    if (latestVersion?.previewKey) {
      artwork = storage.getPublicUrl(latestVersion.previewKey);
    }

    if (latestVersion) {
      const dbPlaceholders = await db
        .select()
        .from(placeholders)
        .where(eq(placeholders.psdVersionId, latestVersion.id));

      pList = dbPlaceholders.map((p) => ({
        id: p.id,
        layerName: p.layerName,
        key: p.key,
        type: p.type as "text" | "image",
        sampleValue: p.sampleValue || undefined,
        box: {
          x: p.box.x,
          y: p.box.y,
          w: p.box.w,
          h: p.box.h,
        },
        options: p.options,
      }));

      issues = await db
        .select()
        .from(validationIssues)
        .where(eq(validationIssues.psdVersionId, latestVersion.id));
    }
  }

  const [genCount] = await db
    .select({ value: count() })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.eventId, e.id),
        eq(analyticsEvents.type, "generated")
      )
    );

  const eventFonts = await db
    .select()
    .from(fonts)
    .where(eq(fonts.eventId, e.id));

  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    date: e.startsAt ? e.startsAt.toISOString().slice(0, 16) : "",
    description: e.description,
    artwork,
    status: e.status === "published" ? "Published" : "Draft",
    count: genCount?.value ?? 0,
    placeholders: pList,
    fonts: eventFonts.map((f) => ({ name: f.family, status: "Uploaded" })),
    formatId: fmt?.id,
    validationIssues: issues,
    manifestUrl,
    manifestKey,
  };
}
