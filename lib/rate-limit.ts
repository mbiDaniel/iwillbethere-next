import { db } from "@/lib/db";
import { rateLimits } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

export async function rateLimit(
  key: string,
  limit: number = 60,
  windowSeconds: number = 60
): Promise<RateLimitResult> {
  const now = new Date();
  const windowMillis = windowSeconds * 1000;
  const currentWindowStart = new Date(Math.floor(now.getTime() / windowMillis) * windowMillis);

  try {
    const query = sql`
      INSERT INTO ${rateLimits} (key, window_start, count)
      VALUES (${key}, ${currentWindowStart}, 1)
      ON CONFLICT (key) DO UPDATE
      SET
        count = CASE
          WHEN ${rateLimits.windowStart} = ${currentWindowStart} THEN ${rateLimits.count} + 1
          ELSE 1
        END,
        window_start = CASE
          WHEN ${rateLimits.windowStart} = ${currentWindowStart} THEN ${rateLimits.windowStart}
          ELSE ${currentWindowStart}
        END
      RETURNING count, window_start;
    `;

    const result = await db.execute(query);
    const row = result.rows[0] as { count: number; window_start: Date };
    const currentCount = Number(row?.count ?? 1);

    const remaining = Math.max(0, limit - currentCount);
    const reset = Math.ceil((currentWindowStart.getTime() + windowMillis - now.getTime()) / 1000);

    return {
      success: currentCount <= limit,
      remaining,
      reset,
    };
  } catch (err) {
    console.warn("Rate limit fallback:", err);
    // Fail open in case of db transient error
    return { success: true, remaining: 1, reset: windowSeconds };
  }
}
