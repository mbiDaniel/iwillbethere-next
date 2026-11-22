import { db } from "@/lib/db";
import { analyticsEvents } from "@/lib/db/schema";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import { createHmac, randomUUID } from "crypto";
import { env } from "@/lib/env";
import { allowedTrafficSources } from "@/lib/schemas";

export function generateVisitorHash(
  ip: string = "127.0.0.1",
  userAgent: string = "unknown",
  eventId: string
): string {
  const today = new Date().toISOString().slice(0, 10);
  const hmac = createHmac("sha256", env.DAILY_ANALYTICS_SECRET);
  hmac.update(`${ip}:::${userAgent}:::${eventId}:::${today}`);
  return hmac.digest("hex").slice(0, 32);
}

export function sanitizeSource(raw?: string | null): string {
  if (!raw) return "direct";
  const normalized = raw.toLowerCase().trim();
  if ((allowedTrafficSources as readonly string[]).includes(normalized)) {
    return normalized;
  }
  return "other";
}

export async function trackEvent(params: {
  eventId: string;
  type: "visit" | "form_started" | "generated" | "downloaded" | "shared";
  format?: string;
  source?: string;
  visitorHash: string;
}): Promise<boolean> {
  const source = sanitizeSource(params.source);

  // Deduplicate visit events per visitor per day
  if (params.type === "visit") {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [existing] = await db
      .select({ id: analyticsEvents.id })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventId, params.eventId),
          eq(analyticsEvents.type, "visit"),
          eq(analyticsEvents.visitorHash, params.visitorHash),
          gte(analyticsEvents.createdAt, todayStart)
        )
      )
      .limit(1);

    if (existing) {
      return false; // Already recorded today
    }
  }

  await db.insert(analyticsEvents).values({
    id: randomUUID(),
    eventId: params.eventId,
    type: params.type,
    format: params.format?.slice(0, 50) || null,
    source,
    visitorHash: params.visitorHash,
    createdAt: new Date(),
  });

  return true;
}

export async function getEventAnalytics(eventId: string, days: number = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const prevPeriodSince = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000);

  // Current period totals
  const currentCounts = await db
    .select({
      type: analyticsEvents.type,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(
      and(eq(analyticsEvents.eventId, eventId), gte(analyticsEvents.createdAt, since))
    )
    .groupBy(analyticsEvents.type);

  // Previous period totals for % comparison
  const prevCounts = await db
    .select({
      type: analyticsEvents.type,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.eventId, eventId),
        gte(analyticsEvents.createdAt, prevPeriodSince),
        sql`${analyticsEvents.createdAt} < ${since}`
      )
    )
    .groupBy(analyticsEvents.type);

  const statsMap: Record<string, { current: number; prev: number }> = {
    visit: { current: 0, prev: 0 },
    form_started: { current: 0, prev: 0 },
    generated: { current: 0, prev: 0 },
    downloaded: { current: 0, prev: 0 },
    shared: { current: 0, prev: 0 },
  };

  for (const row of currentCounts) {
    if (statsMap[row.type]) statsMap[row.type].current = row.count;
  }
  for (const row of prevCounts) {
    if (statsMap[row.type]) statsMap[row.type].prev = row.count;
  }

  // Daily time series
  const dailyRows = await db
    .select({
      day: sql<string>`to_char(${analyticsEvents.createdAt}, 'YYYY-MM-DD')`,
      type: analyticsEvents.type,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(
      and(eq(analyticsEvents.eventId, eventId), gte(analyticsEvents.createdAt, since))
    )
    .groupBy(sql`1, 2`)
    .orderBy(sql`1 ASC`);

  // Sources breakdown
  const sourceRows = await db
    .select({
      source: analyticsEvents.source,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(
      and(eq(analyticsEvents.eventId, eventId), gte(analyticsEvents.createdAt, since))
    )
    .groupBy(analyticsEvents.source)
    .orderBy(desc(sql`2`));

  // Formats breakdown
  const formatRows = await db
    .select({
      format: analyticsEvents.format,
      count: sql<number>`count(*)::int`,
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.eventId, eventId),
        gte(analyticsEvents.createdAt, since),
        sql`${analyticsEvents.format} IS NOT NULL`
      )
    )
    .groupBy(analyticsEvents.format)
    .orderBy(desc(sql`2`));

  return {
    periodDays: days,
    stats: statsMap,
    timeSeries: dailyRows,
    sources: sourceRows,
    formats: formatRows,
  };
}
