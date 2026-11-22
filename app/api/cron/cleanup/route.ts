import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { events, psdVersions, versionAssets, analyticsEvents } from "@/lib/db/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";

export async function POST(req: NextRequest) {
  // Check secret header
  const authHeader = req.headers.get("authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret) {
    const bearerToken = authHeader?.replace(/^Bearer\s+/i, "");
    if (bearerToken !== expectedSecret && cronSecretHeader !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = {
    stuckVersionsPurged: 0,
    softDeletedEventsPurged: 0,
    analyticsPruned: 0,
  };

  try {
    // 1. Delete versions stuck in 'uploading' for > 24 hours
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuckVersions = await db
      .select()
      .from(psdVersions)
      .where(and(eq(psdVersions.status, "uploading"), lt(psdVersions.createdAt, dayAgo)));

    for (const ver of stuckVersions) {
      const assets = await db
        .select()
        .from(versionAssets)
        .where(eq(versionAssets.psdVersionId, ver.id));

      for (const a of assets) {
        // Delete if no other version references sha256
        const [other] = await db
          .select({ id: versionAssets.id })
          .from(versionAssets)
          .where(and(eq(versionAssets.sha256, a.sha256), eq(versionAssets.psdVersionId, ver.id)))
          .limit(1);

        if (!other) {
          await storage.deleteObject(env.R2_BUCKET_PUBLIC, a.key).catch(() => {});
        }
      }

      if (ver.psdKey) {
        await storage.deleteObject(env.R2_BUCKET_PRIVATE, ver.psdKey).catch(() => {});
      }
      if (ver.manifestKey) {
        await storage.deleteObject(env.R2_BUCKET_PUBLIC, ver.manifestKey).catch(() => {});
      }

      await db.delete(psdVersions).where(eq(psdVersions.id, ver.id));
      results.stuckVersionsPurged++;
    }

    // 2. Purge soft-deleted events older than 30 days
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const purgedEvents = await db
      .select({ id: events.id })
      .from(events)
      .where(and(isNotNull(events.deletedAt), lt(events.deletedAt, monthAgo)));

    for (const e of purgedEvents) {
      await db.delete(events).where(eq(events.id, e.id));
      results.softDeletedEventsPurged++;
    }

    // 3. Prune old analytics events older than 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const deleteAnalyticsRes = await db
      .delete(analyticsEvents)
      .where(lt(analyticsEvents.createdAt, ninetyDaysAgo));

    results.analyticsPruned = 1;

    return NextResponse.json({ ok: true, data: results });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Cleanup failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
