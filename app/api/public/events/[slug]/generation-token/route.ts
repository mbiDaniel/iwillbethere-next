import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, generationTokens, analyticsEvents } from "@/lib/db/schema";
import { eq, and, isNull, count } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { randomUUID } from "crypto";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  const limiter = await rateLimit(`gentoken:${ip}`, 30, 60);
  if (!limiter.success) {
    return NextResponse.json(
      { error: "Too many token requests. Please slow down." },
      { status: 429 }
    );
  }

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
      { error: "Event unavailable or registration closed." },
      { status: 404 }
    );
  }

  // 1. Deadline check
  const now = new Date();
  if (event.closesAt && event.closesAt < now) {
    return NextResponse.json(
      { error: "Flyer personalization has closed for this event." },
      { status: 403 }
    );
  }

  // 2. Capacity check
  if (event.maxFlyers && event.maxFlyers > 0) {
    const [genCount] = await db
      .select({ value: count() })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventId, event.id),
          eq(analyticsEvents.type, "generated")
        )
      );

    const generated = genCount?.value ?? 0;
    if (generated >= event.maxFlyers) {
      return NextResponse.json(
        { error: "The maximum number of flyers for this event has been reached." },
        { status: 403 }
      );
    }
  }

  // Issue 15-minute generation token
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(generationTokens).values({
    id: randomUUID(),
    eventId: event.id,
    token,
    expiresAt,
    usedAt: null,
  });

  return NextResponse.json({
    ok: true,
    token,
    expiresAt: expiresAt.toISOString(),
  });
}
