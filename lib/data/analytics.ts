import "server-only";

import { getEventAnalytics } from "@/lib/analytics";

export async function fetchEventAnalytics(eventId: string, days: number = 30) {
  return await getEventAnalytics(eventId, days);
}
