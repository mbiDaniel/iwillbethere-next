import { NextRequest, NextResponse } from "next/server";
import { storage } from "@/lib/storage";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    // 1. Authenticate user
    await requireUser();

    // 2. Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get("key");
    const bucketType = searchParams.get("bucket") || "private";
    const bucket = bucketType === "public" ? env.R2_BUCKET_PUBLIC : env.R2_BUCKET_PRIVATE;

    if (!key) {
      return NextResponse.json({ error: "Missing file key" }, { status: 400 });
    }

    const contentType =
      request.headers.get("content-type") || "application/octet-stream";

    // 3. Read body bytes
    const arrayBuffer = await request.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 4. Save to storage
    await storage.putObject(bucket, key, buffer, contentType);

    return NextResponse.json({ ok: true, key, sizeBytes: buffer.length });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Upload proxy error";
    console.error("Upload proxy error:", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
