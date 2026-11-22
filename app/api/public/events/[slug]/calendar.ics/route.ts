import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { generateIcs } from "@/lib/calendar";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

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

  if (!event || !event.startsAt) {
    return NextResponse.json({ error: "Calendar not found" }, { status: 404 });
  }

  const icsData = generateIcs({
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    venueName: event.venueName,
    address: event.address,
    url: `${request.nextUrl.origin}/e/${slug}`,
  });

  return new NextResponse(icsData, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${slug}.ics"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
