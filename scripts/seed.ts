import { config } from "dotenv";
config();

import { db, pool } from "../lib/db";
import {
  user,
  account,
  events,
  eventFormats,
  psdVersions,
  placeholders,
  validationIssues,
  versionAssets,
  analyticsEvents,
} from "../lib/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { createValidFixturePsd } from "./generate-fixtures";
import { storage } from "../lib/storage";
import { env } from "../lib/env";
import { slicePsd } from "../lib/flyer/slice";
import { randomUUID } from "crypto";
import { generateVisitorHash } from "../lib/analytics";

async function seed() {
  console.log("🌱 Starting database seed...");

  const demoUserId = "user_demo_designer";
  const demoEmail = "designer@iwillbethere.com";
  const demoPassword = "Password123!";

  // 1. Create or update demo designer user
  const hashedPassword = await hashPassword(demoPassword);

  const [existingUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, demoEmail));

  if (!existingUser) {
    await db.insert(user).values({
      id: demoUserId,
      name: "Jamie Park",
      email: demoEmail,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(account).values({
      id: randomUUID(),
      accountId: demoUserId,
      providerId: "credential",
      userId: demoUserId,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`👤 Created demo designer user: ${demoEmail} (Password: ${demoPassword})`);
  } else {
    console.log(`👤 Demo designer user already exists: ${demoEmail}`);
  }

  // 2. Create sample published event "after-hours"
  const slug = "after-hours";
  const [existingEvent] = await db
    .select()
    .from(events)
    .where(eq(events.slug, slug));

  if (!existingEvent) {
    const eventId = "event_after_hours";
    const formatId = "format_after_hours_square";
    const versionId = "version_after_hours_v1";

    await db.insert(events).values({
      id: eventId,
      ownerId: demoUserId,
      slug,
      title: "After Hours",
      description:
        "One night of live music in Brooklyn. Put your name on the lineup of guests.",
      status: "published",
      prefix: "#PLACEHOLDER_",
      hashtag: "#AfterHoursBK",
      shareCaption: "I'll be there! Join me at After Hours in Brooklyn.",
      venueName: "Public Records",
      address: "233 Butler St, Brooklyn, NY",
      mapUrl: "https://maps.google.com/?q=233+Butler+St+Brooklyn+NY",
      startsAt: new Date("2026-10-24T21:00:00Z"),
      timeZone: "America/New_York",
      maxFlyers: 250,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.insert(eventFormats).values({
      id: formatId,
      eventId,
      format: "square",
      enabled: true,
      publishedVersionId: versionId,
    });

    // 3. Generate and slice fixture PSD
    console.log("🎨 Slicing fixture PSD into artwork slices and placeholders...");
    const fixturePsdBuffer = createValidFixturePsd();
    const sliceResult = await slicePsd(fixturePsdBuffer);

    // Upload backup PSD to private bucket
    const psdKey = `events/${eventId}/versions/${versionId}/backup.psd`;
    await storage.putObject(
      env.R2_BUCKET_PRIVATE,
      psdKey,
      fixturePsdBuffer,
      "image/vnd.adobe.photoshop"
    );

    // Upload slices and masks to public bucket
    const versionPrefix = `events/${eventId}/versions/${versionId}/`;
    for (const asset of sliceResult.assets) {
      const ext = asset.contentType === "image/webp" ? "webp" : "png";
      const folder = asset.kind === "slice" ? "slices" : "masks";
      const key = `${versionPrefix}${folder}/${asset.sha256}.${ext}`;
      const buf = Buffer.from(await asset.blob.arrayBuffer());
      await storage.putObject(env.R2_BUCKET_PUBLIC, key, buf, asset.contentType);

      await db
        .insert(versionAssets)
        .values({
          id: randomUUID(),
          psdVersionId: versionId,
          kind: asset.kind,
          tier: asset.tier,
          key,
          sha256: asset.sha256,
          bytes: asset.bytes,
          width: asset.width,
          height: asset.height,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
    }

    // Upload manifest JSON to public bucket
    const manifestKey = `${versionPrefix}manifest.json`;
    await storage.putObject(
      env.R2_BUCKET_PUBLIC,
      manifestKey,
      Buffer.from(JSON.stringify(sliceResult.manifest), "utf8"),
      "application/json"
    );

    const firstSlice = sliceResult.manifest.items.find((i) => i.kind === "slice");
    const previewKey = firstSlice?.kind === "slice" ? firstSlice.assets.preview.key : null;

    // 4. Create PSD version record in DB
    await db.insert(psdVersions).values({
      id: versionId,
      eventFormatId: formatId,
      version: 1,
      psdKey,
      psdUploadStatus: "uploaded",
      sizeBytes: fixturePsdBuffer.length,
      width: sliceResult.manifest.width,
      height: sliceResult.manifest.height,
      status: "ready",
      manifestKey,
      previewKey,
      cleanPreviewKey: previewKey,
      sliceCount: sliceResult.manifest.items.filter((i) => i.kind === "slice").length,
      totalPreviewBytes: sliceResult.manifest.tiers.preview.totalBytes,
      totalFullBytes: sliceResult.manifest.tiers.full.totalBytes,
      fidelityScore: sliceResult.manifest.fidelity ? String(sliceResult.manifest.fidelity.score) : "1.0",
      createdAt: new Date(),
    });

    // 5. Insert placeholders
    for (const p of sliceResult.manifest.placeholders) {
      await db.insert(placeholders).values({
        id: p.id,
        psdVersionId: versionId,
        layerId: `layer_${p.id}`,
        layerName: p.layerName,
        key: p.key,
        type: p.type,
        sampleValue: p.options.sampleValue,
        box: {
          x: Number(((p.box.x / sliceResult.manifest.width) * 100).toFixed(2)),
          y: Number(((p.box.y / sliceResult.manifest.height) * 100).toFixed(2)),
          w: Number(((p.box.w / sliceResult.manifest.width) * 100).toFixed(2)),
          h: Number(((p.box.h / sliceResult.manifest.height) * 100).toFixed(2)),
          xPx: p.box.x,
          yPx: p.box.y,
          wPx: p.box.w,
          hPx: p.box.h,
        },
        options: p.options as any,
        textStyle: p.textStyle,
        maskKey: p.mask?.full.key,
      });
    }

    // 6. Seed sample analytics events
    const sampleVisitor = generateVisitorHash("192.168.1.1", "SampleUA", eventId);
    const eventTypes: Array<"visit" | "form_started" | "generated" | "downloaded" | "shared"> = [
      "visit",
      "visit",
      "visit",
      "form_started",
      "form_started",
      "generated",
      "downloaded",
    ];

    for (const type of eventTypes) {
      await db.insert(analyticsEvents).values({
        id: randomUUID(),
        eventId,
        type,
        format: "square",
        source: "instagram",
        visitorHash: sampleVisitor,
        createdAt: new Date(),
      });
    }

    console.log(`🎉 Seeded published event "${slug}" with flyer manifest and slices!`);
  } else {
    console.log(`ℹ️ Event "${slug}" already seeded.`);
  }

  console.log("✅ Database seeding complete!");
}

seed()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
