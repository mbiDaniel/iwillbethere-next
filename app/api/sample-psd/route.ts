import { NextResponse } from "next/server";
import { createValidFixturePsd } from "@/scripts/generate-fixtures";

export async function GET() {
  const buffer = createValidFixturePsd();
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/vnd.adobe.photoshop",
      "Content-Disposition": 'attachment; filename="after-hours.psd"',
    },
  });
}
