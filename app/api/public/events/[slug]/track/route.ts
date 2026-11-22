import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { trackAnalyticsSchema } from "@/lib/schemas";
import { generateVisitorHash, trackEvent } from "@/lib/analytics";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  // Rate limit by IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  const limiter = await rateLimit(`track:${ip}`, 120, 60);
  if (!limiter.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  const [event] = await db
    .select({ id: events.id, status: events.status })
    .from(events)
    .where(and(eq(events.slug, slug), isNull(events.deletedAt)));

  if (!event || event.status !== "published") {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = trackAnalyticsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid tracking payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const userAgent = request.headers.get("user-agent") || "unknown";
  const visitorHash = generateVisitorHash(ip, userAgent, event.id);

  const recorded = await trackEvent({
    eventId: event.id,
    type: parsed.data.type,
    format: parsed.data.format,
    source: parsed.data.source,
    visitorHash,
  });

  return NextResponse.json({ ok: true, recorded });
}
