import { requireUser } from "@/lib/auth";
export { requireUser };
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; issues?: unknown; code?: string };

export async function requireEventOwner(eventId: string) {
  const user = await requireUser();
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.deletedAt)));

  if (!event) {
    throw new Error("Event not found or has been deleted");
  }

  if (event.ownerId !== user.id) {
    throw new Error("Forbidden: You do not own this event");
  }

  return { user, event };
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
