import { describe, it, expect } from "vitest";
import { generateIcs, getGoogleCalendarUrl } from "@/lib/calendar";
import { slugify } from "@/lib/actions/utils";

describe("Calendar & Slug - Unit Tests", () => {
  it("generates valid RFC 5545 .ics calendar content with proper escaping", () => {
    const ics = generateIcs({
      id: "event_123",
      title: "Design & Drinks, Brooklyn; NY",
      description: "Line 1\nLine 2, with comma and ; semicolon.",
      startsAt: new Date("2026-10-24T21:00:00Z"),
      venueName: "Public Records",
      address: "233 Butler St",
      url: "https://iwillbethere.com/e/after-hours",
    });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("UID:event-event_123@iwillbethere.com");
    expect(ics).toContain("SUMMARY:Design & Drinks\\, Brooklyn\\; NY");
    expect(ics).toContain("DESCRIPTION:Line 1\\nLine 2\\, with comma and \\; semicolon.");
    expect(ics).toContain("LOCATION:Public Records\\, 233 Butler St");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("builds valid Google Calendar URL", () => {
    const url = getGoogleCalendarUrl({
      id: "event_123",
      title: "Launch Party",
      description: "Celebrate with us",
      startsAt: new Date("2026-10-24T21:00:00Z"),
    });

    expect(url).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(url).toContain("text=Launch+Party");
    expect(url).toContain("details=Celebrate+with+us");
  });

  it("slugifies titles reliably", () => {
    expect(slugify("After Hours Party!")).toBe("after-hours-party");
    expect(slugify("---Hello   World---")).toBe("hello-world");
    expect(slugify("Design & Code @ 2026")).toBe("design-code-2026");
  });
});
