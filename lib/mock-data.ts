import type { Event, Placeholder } from "./types";
export const slots: Placeholder[] = [
  {
    id: "photo",
    layerName: "#PLACEHOLDER_photo",
    key: "photo",
    type: "image",
    sampleValue: "/jamie.png",
    box: { x: 5, y: 84, w: 17, h: 11.4 },
    options: { fit: "cover", useShapeAsMask: true },
  },
  {
    id: "name",
    layerName: "#PLACEHOLDER_Name",
    key: "Name",
    type: "text",
    sampleValue: "Jamie Park",
    box: { x: 26, y: 89, w: 57, h: 7 },
    options: {
      maxLines: 1,
      maxLength: 40,
      align: "left",
      minFontSize: 9,
      maxFontSize: 28,
      fallbackFont: "Arial",
    },
  },
];
export const events: Event[] = [
  {
    id: "after-hours",
    slug: "after-hours",
    title: "After Hours",
    date: "2026-10-24T21:00",
    description:
      "One night of live music in Brooklyn. Put your name on the lineup of guests.",
    artwork: "/afterhours.png",
    count: 84,
    status: "Published",
    placeholders: slots,
    fonts: [],
  },
  {
    id: "open-studio",
    slug: "open-studio",
    title: "Open Studio",
    date: "2026-12-05T15:00",
    description: "An afternoon of ideas, prints, and open studio doors.",
    artwork: "/open-studio.svg",
    count: 0,
    status: "Draft",
    placeholders: slots,
    fonts: [],
  },
];
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "Z"));
}
