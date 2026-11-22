import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, generationTokens, analyticsEvents } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { reportGeneratedSchema } from "@/lib/schemas";
import { generateVisitorHash } from "@/lib/analytics";
import { randomUUID } from "crypto";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reportGeneratedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token payload" }, { status: 400 });
  }

  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.slug, slug), isNull(events.deletedAt)));

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const visitorHash = generateVisitorHash(ip, userAgent, event.id);

  // Verify and mark token used in transaction
  const result = await db.transaction(async (tx) => {
    const [tokenRow] = await tx
      .select()
      .from(generationTokens)
      .where(
        and(
          eq(generationTokens.token, parsed.data.token),
          eq(generationTokens.eventId, event.id)
        )
      );

    if (!tokenRow) {
      return { ok: false, error: "Invalid generation token", status: 400 };
    }

    if (tokenRow.expiresAt < new Date()) {
      return { ok: false, error: "Generation token has expired", status: 403 };
    }

    // Idempotent: if already used, do not re-increment
    if (tokenRow.usedAt) {
      return { ok: true, alreadyUsed: true, status: 200 };
    }

    // Mark used
    await tx
      .update(generationTokens)
      .set({ usedAt: new Date() })
      .where(eq(generationTokens.id, tokenRow.id));

    // Record anonymous generated flyer event
    await tx.insert(analyticsEvents).values({
      id: randomUUID(),
      eventId: event.id,
      type: "generated",
      format: parsed.data.format || "square",
      source: "direct",
      visitorHash,
      createdAt: new Date(),
    });

    return { ok: true, alreadyUsed: false, status: 200 };
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, recorded: !result.alreadyUsed });
}
