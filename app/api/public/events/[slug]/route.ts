import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, eventFormats, psdVersions } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";
import { createHash } from "crypto";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // 1. Fetch published event
  const [event] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.slug, slug),
        eq(events.status, "published"),
        isNull(events.deletedAt)
      )
    );

  if (!event) {
    return NextResponse.json(
      { error: "Event not found or unavailable" },
      { status: 404 }
    );
  }

  // 2. Fetch enabled formats with published versions
  const formats = await db
    .select()
    .from(eventFormats)
    .where(and(eq(eventFormats.eventId, event.id), eq(eventFormats.enabled, true)));

  const formatList = [];

  for (const fmt of formats) {
    if (!fmt.publishedVersionId) continue;

    const [version] = await db
      .select()
      .from(psdVersions)
      .where(eq(psdVersions.id, fmt.publishedVersionId));

    if (!version || version.status !== "ready" || !version.manifestKey) continue;

    let manifest = null;
    try {
      const manifestBuffer = await storage.getObject(
        env.R2_BUCKET_PUBLIC,
        version.manifestKey
      );
      manifest = JSON.parse(manifestBuffer.toString("utf-8"));
    } catch (err) {
      console.error("Failed to read manifest:", err);
    }

    formatList.push({
      format: fmt.format,
      version: version.version,
      width: version.width,
      height: version.height,
      previewUrl: version.previewKey ? storage.getPublicUrl(version.previewKey) : null,
      cleanPreviewUrl: version.cleanPreviewKey
        ? storage.getPublicUrl(version.cleanPreviewKey)
        : null,
      manifest,
    });
  }

  const responseData = {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    venueName: event.venueName,
    address: event.address,
    mapUrl: event.mapUrl,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: event.timeZone,
    hashtag: event.hashtag,
    shareCaption: event.shareCaption,
    dressCode: event.dressCode,
    contact: event.contact,
    closesAt: event.closesAt,
    maxFlyers: event.maxFlyers,
    updatedAt: event.updatedAt,
    formats: formatList,
  };

  // ETag calculation
  const etag = `"${createHash("md5").update(JSON.stringify(responseData)).digest("hex")}"`;

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304 });
  }

  return NextResponse.json(responseData, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      ETag: etag,
    },
  });
}
