export interface CalendarEventData {
  id: string;
  title: string;
  description: string;
  startsAt: Date;
  endsAt?: Date | null;
  venueName?: string | null;
  address?: string | null;
  url?: string;
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function formatIcsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function generateIcs(event: CalendarEventData): string {
  const dtStart = formatIcsDate(event.startsAt);
  const dtEnd = formatIcsDate(
    event.endsAt || new Date(event.startsAt.getTime() + 3 * 60 * 60 * 1000)
  );
  const dtStamp = formatIcsDate(new Date());

  const location = [event.venueName, event.address].filter(Boolean).join(", ");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//I Will Be There//Flyer Studio//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:event-${event.id}@iwillbethere.com`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description || "")}`,
  ];

  if (location) {
    lines.push(`LOCATION:${escapeIcsText(location)}`);
  }

  if (event.url) {
    lines.push(`URL:${event.url}`);
  }

  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");

  return lines.join("\r\n");
}

export function getGoogleCalendarUrl(event: CalendarEventData): string {
  const startStr = formatIcsDate(event.startsAt);
  const endStr = formatIcsDate(
    event.endsAt || new Date(event.startsAt.getTime() + 3 * 60 * 60 * 1000)
  );
  const location = [event.venueName, event.address].filter(Boolean).join(", ");

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${startStr}/${endStr}`,
    details: event.description || "",
    location: location || "",
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
