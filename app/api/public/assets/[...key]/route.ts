import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params;
  const objectKey = key.join("/");

  try {
    const buffer = await storage.getObject(env.R2_BUCKET_PUBLIC, objectKey);

    let contentType = "application/octet-stream";
    if (objectKey.endsWith(".png")) contentType = "image/png";
    else if (objectKey.endsWith(".jpg") || objectKey.endsWith(".jpeg"))
      contentType = "image/jpeg";
    else if (objectKey.endsWith(".webp")) contentType = "image/webp";
    else if (objectKey.endsWith(".svg")) contentType = "image/svg+xml";
    else if (objectKey.endsWith(".json")) contentType = "application/json";
    else if (objectKey.endsWith(".woff2")) contentType = "font/woff2";
    else if (objectKey.endsWith(".woff")) contentType = "font/woff";
    else if (objectKey.endsWith(".ttf")) contentType = "font/ttf";
    else if (objectKey.endsWith(".otf")) contentType = "font/otf";

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
}
