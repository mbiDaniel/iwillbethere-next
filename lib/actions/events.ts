"use server";

import { db } from "@/lib/db";
import {
  events,
  eventFormats,
  psdVersions,
  placeholders,
  fonts,
  validationIssues,
  analyticsEvents,
} from "@/lib/db/schema";
import { eq, and, isNull, desc, count, sql } from "drizzle-orm";
import { ActionResult, requireEventOwner, slugify } from "./utils";
import { createEventSchema, updateEventSchema } from "@/lib/schemas";
import { requireUser } from "@/lib/auth";
import { randomUUID } from "crypto";
import { enqueueJob } from "@/lib/queue";

export async function createEvent(
  input: unknown
): Promise<ActionResult<{ id: string; slug: string; formatId: string }>> {
  try {
    const user = await requireUser();
    const parsed = createEventSchema.parse(input);

    let baseSlug = slugify(parsed.title) || "event";
    let slug = baseSlug;
    let attempt = 1;

    while (true) {
      const existing = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.slug, slug));

      if (existing.length === 0) break;
      slug = `${baseSlug}-${attempt++}`;
    }

    const eventId = randomUUID();
    const formatId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(events).values({
        id: eventId,
        ownerId: user.id,
        slug,
        title: parsed.title,
        description: parsed.description,
        status: "draft",
        prefix: parsed.prefix || "#PLACEHOLDER_",
        hashtag: parsed.hashtag,
        shareCaption: parsed.shareCaption,
        venueName: parsed.venueName,
        address: parsed.address,
        mapUrl: parsed.mapUrl,
        startsAt: parsed.date ? new Date(parsed.date) : null,
        timeZone: parsed.timeZone || "UTC",
        dressCode: parsed.dressCode,
        contact: parsed.contact,
        closesAt: parsed.closesAt ? new Date(parsed.closesAt) : null,
        maxFlyers: parsed.maxFlyers,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await tx.insert(eventFormats).values({
        id: formatId,
        eventId,
        format: "square",
        enabled: true,
      });
    });

    return { ok: true, data: { id: eventId, slug, formatId } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to create event";
    return { ok: false, error: msg };
  }
}

export async function updateEvent(
  eventId: string,
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireEventOwner(eventId);
    const parsed = updateEventSchema.parse(input);

    if (parsed.slug) {
      const cleanSlug = slugify(parsed.slug);
      const existing = await db
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.slug, cleanSlug), isNull(events.deletedAt)));

      if (existing.length > 0 && existing[0].id !== eventId) {
        return { ok: false, error: "This URL slug is already taken." };
      }
      parsed.slug = cleanSlug;
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (parsed.title !== undefined) updateData.title = parsed.title;
    if (parsed.description !== undefined) updateData.description = parsed.description;
    if (parsed.slug !== undefined) updateData.slug = parsed.slug;
    if (parsed.prefix !== undefined) updateData.prefix = parsed.prefix;
    if (parsed.hashtag !== undefined) updateData.hashtag = parsed.hashtag;
    if (parsed.shareCaption !== undefined) updateData.shareCaption = parsed.shareCaption;
    if (parsed.venueName !== undefined) updateData.venueName = parsed.venueName;
    if (parsed.address !== undefined) updateData.address = parsed.address;
    if (parsed.mapUrl !== undefined) updateData.mapUrl = parsed.mapUrl;
    if (parsed.date !== undefined) updateData.startsAt = new Date(parsed.date);
    if (parsed.timeZone !== undefined) updateData.timeZone = parsed.timeZone;
    if (parsed.dressCode !== undefined) updateData.dressCode = parsed.dressCode;
    if (parsed.contact !== undefined) updateData.contact = parsed.contact;
    if (parsed.closesAt !== undefined) {
      updateData.closesAt = parsed.closesAt ? new Date(parsed.closesAt) : null;
    }
    if (parsed.maxFlyers !== undefined) updateData.maxFlyers = parsed.maxFlyers;

    await db.update(events).set(updateData).where(eq(events.id, eventId));

    return { ok: true, data: { id: eventId } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to update event";
    return { ok: false, error: msg };
  }
}

export async function duplicateEvent(
  eventId: string
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const { user, event: original } = await requireEventOwner(eventId);

    let baseSlug = `${original.slug}-copy`;
    let slug = baseSlug;
    let attempt = 1;

    while (true) {
      const existing = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.slug, slug));

      if (existing.length === 0) break;
      slug = `${baseSlug}-${attempt++}`;
    }

    const newEventId = randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(events).values({
        id: newEventId,
        ownerId: user.id,
        slug,
        title: `${original.title} (copy)`,
        description: original.description,
        status: "draft",
        prefix: original.prefix,
        hashtag: original.hashtag,
        shareCaption: original.shareCaption,
        venueName: original.venueName,
        address: original.address,
        mapUrl: original.mapUrl,
        startsAt: original.startsAt,
        endsAt: original.endsAt,
        timeZone: original.timeZone,
        schedule: original.schedule,
        dressCode: original.dressCode,
        contact: original.contact,
        closesAt: original.closesAt,
        maxFlyers: original.maxFlyers,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Duplicate formats
      const originalFormats = await tx
        .select()
        .from(eventFormats)
        .where(eq(eventFormats.eventId, eventId));

      for (const fmt of originalFormats) {
        await tx.insert(eventFormats).values({
          id: randomUUID(),
          eventId: newEventId,
          format: fmt.format,
          enabled: fmt.enabled,
        });
      }
    });

    return { ok: true, data: { id: newEventId, slug } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to duplicate event";
    return { ok: false, error: msg };
  }
}

export async function archiveEvent(
  eventId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireEventOwner(eventId);
    await db
      .update(events)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(events.id, eventId));

    return { ok: true, data: { id: eventId } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to archive event";
    return { ok: false, error: msg };
  }
}

export async function deleteEvent(
  eventId: string
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireEventOwner(eventId);
    await db
      .update(events)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(events.id, eventId));

    // Enqueue purge maintenance job
    await enqueueJob("PURGE_DELETED_EVENTS", { eventId });

    return { ok: true, data: { id: eventId } };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to delete event";
    return { ok: false, error: msg };
  }
}

export async function listEvents(): Promise<
  ActionResult<
    Array<{
      id: string;
      slug: string;
      title: string;
      date: string;
      description: string;
      artwork: string;
      status: "Published" | "Draft";
      count: number;
    }>
  >
> {
  try {
    const user = await requireUser();

    const userEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.ownerId, user.id), isNull(events.deletedAt)))
      .orderBy(desc(events.createdAt));

    const result = [];

    for (const e of userEvents) {
      // Find flyers generated count
      const [genCount] = await db
        .select({ value: count() })
        .from(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.eventId, e.id),
            eq(analyticsEvents.type, "generated")
          )
        );

      // Find primary format & preview artwork
      const [fmt] = await db
        .select()
        .from(eventFormats)
        .where(eq(eventFormats.eventId, e.id));

      let artwork = "/open-studio.svg";
      if (fmt) {
        const [latestVersion] = await db
          .select()
          .from(psdVersions)
          .where(eq(psdVersions.eventFormatId, fmt.id))
          .orderBy(desc(psdVersions.version))
          .limit(1);

        if (latestVersion?.previewKey) {
          artwork = `/api/public/assets/${latestVersion.previewKey}`;
        }
      }

      result.push({
        id: e.id,
        slug: e.slug,
        title: e.title,
        date: e.startsAt ? e.startsAt.toISOString().slice(0, 16) : "",
        description: e.description,
        artwork,
        status: (e.status === "published" ? "Published" : "Draft") as
          | "Published"
          | "Draft",
        count: genCount?.value ?? 0,
      });
    }

    return { ok: true, data: result };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to list events";
    return { ok: false, error: msg };
  }
}

export async function getEvent(eventId: string) {
  try {
    await requireEventOwner(eventId);

    const [event] = await db
      .select()
      .from(events)
      .where(and(eq(events.id, eventId), isNull(events.deletedAt)));

    if (!event) return null;

    const formats = await db
      .select()
      .from(eventFormats)
      .where(eq(eventFormats.eventId, eventId));

    const eventFontList = await db
      .select()
      .from(fonts)
      .where(eq(fonts.eventId, eventId));

    // Get latest version for each format
    const formatDetails = [];
    for (const fmt of formats) {
      const versions = await db
        .select()
        .from(psdVersions)
        .where(eq(psdVersions.eventFormatId, fmt.id))
        .orderBy(desc(psdVersions.version));

      const activeVersion = versions[0] || null;

      let versionPlaceholders: any[] = [];
      let versionIssues: any[] = [];

      if (activeVersion) {
        versionPlaceholders = await db
          .select()
          .from(placeholders)
          .where(eq(placeholders.psdVersionId, activeVersion.id));

        versionIssues = await db
          .select()
          .from(validationIssues)
          .where(eq(validationIssues.psdVersionId, activeVersion.id));
      }

      formatDetails.push({
        ...fmt,
        activeVersion,
        versions,
        placeholders: versionPlaceholders,
        validationIssues: versionIssues,
      });
    }

    const [genCount] = await db
      .select({ value: count() })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventId, event.id),
          eq(analyticsEvents.type, "generated")
        )
      );

    return {
      ...event,
      formats: formatDetails,
      fonts: eventFontList,
      generatedCount: genCount?.value ?? 0,
    };
  } catch {
    return null;
  }
}
