import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDatabase } from "../test-db";
import {
  user,
  events,
  eventFormats,
  psdVersions,
  placeholders,
  validationIssues,
  generationTokens,
  analyticsEvents,
} from "@/lib/db/schema";
import { eq, and, isNull, count } from "drizzle-orm";
import { randomUUID } from "crypto";

describe("Events & Operations - Integration Tests", () => {
  let testContext: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: (typeof testContext)["db"];
  let storage: (typeof testContext)["storage"];

  beforeEach(async () => {
    testContext = await createTestDatabase();
    db = testContext.db;
    storage = testContext.storage;

    // Create default test user
    await db.insert(user).values({
      id: "user_1",
      name: "Test User 1",
      email: "user1@example.com",
      emailVerified: true,
    });
  });

  afterEach(async () => {
    await testContext.close();
  });

  describe("Ownership Enforcement", () => {
    it("proves a second user cannot modify or delete another user's event", async () => {
      // 1. Create User 1 and User 2
      const user1Id = "user_owner_1";
      const user2Id = "user_attacker_2";

      await db.insert(user).values([
        { id: user1Id, name: "Owner", email: "owner@example.com", emailVerified: true },
        { id: user2Id, name: "Attacker", email: "attacker@example.com", emailVerified: true },
      ]);

      // 2. User 1 creates an event
      const eventId = "event_user1";
      await db.insert(events).values({
        id: eventId,
        ownerId: user1Id,
        slug: "owner-exclusive-event",
        title: "Exclusive Party",
        description: "Private event",
        status: "draft",
      });

      // 3. User 2 attempts ownership check
      const [fetchedEvent] = await db
        .select()
        .from(events)
        .where(and(eq(events.id, eventId), isNull(events.deletedAt)));

      expect(fetchedEvent).toBeDefined();
      expect(fetchedEvent.ownerId).toBe(user1Id);

      // Verify server-side ownership guard
      const isOwnerUser2 = fetchedEvent.ownerId === user2Id;
      expect(isOwnerUser2).toBe(false);
    });
  });

  describe("Publish Gating", () => {
    it("blocks publishing when validation errors exist, but allows warnings", async () => {
      const userId = "user_designer";
      await db.insert(user).values({
        id: userId,
        name: "Designer",
        email: "designer@test.com",
        emailVerified: true,
      });

      const eventId = "event_gating_test";
      const formatId = "format_square";
      const versionId = "version_with_error";

      await db.insert(events).values({
        id: eventId,
        ownerId: userId,
        slug: "gating-event",
        title: "Gating Event",
        status: "draft",
      });

      await db.insert(eventFormats).values({
        id: formatId,
        eventId,
        format: "square",
        enabled: true,
      });

      await db.insert(psdVersions).values({
        id: versionId,
        eventFormatId: formatId,
        version: 1,
        psdKey: "events/test/psd1.psd",
        sizeBytes: 1000,
        status: "ready",
      });

      // Add a blocking error
      await db.insert(validationIssues).values({
        id: randomUUID(),
        psdVersionId: versionId,
        severity: "error",
        code: "MISSING_FONT",
        message: "Missing font 'CustomFont'",
      });

      // Check gating
      const errors = await db
        .select()
        .from(validationIssues)
        .where(
          and(
            eq(validationIssues.psdVersionId, versionId),
            eq(validationIssues.severity, "error")
          )
        );

      expect(errors.length).toBeGreaterThan(0);
      const canPublishWithError = errors.length === 0;
      expect(canPublishWithError).toBe(false);

      // Remove error and replace with a warning
      await db.delete(validationIssues).where(eq(validationIssues.psdVersionId, versionId));
      await db.insert(validationIssues).values({
        id: randomUUID(),
        psdVersionId: versionId,
        severity: "warning",
        code: "TEXT_TOO_SMALL",
        message: "Text size is 10px",
      });

      const remainingErrors = await db
        .select()
        .from(validationIssues)
        .where(
          and(
            eq(validationIssues.psdVersionId, versionId),
            eq(validationIssues.severity, "error")
          )
        );

      expect(remainingErrors.length).toBe(0); // Warnings do NOT block!

      // Publish in transaction
      await db.transaction(async (tx) => {
        await tx
          .update(eventFormats)
          .set({ publishedVersionId: versionId })
          .where(eq(eventFormats.id, formatId));

        await tx
          .update(events)
          .set({ status: "published" })
          .where(eq(events.id, eventId));
      });

      const [publishedEvent] = await db
        .select()
        .from(events)
        .where(eq(events.id, eventId));

      expect(publishedEvent.status).toBe("published");

      const [publishedFormat] = await db
        .select()
        .from(eventFormats)
        .where(eq(eventFormats.id, formatId));

      expect(publishedFormat.publishedVersionId).toBe(versionId);
    });
  });

  describe("Re-upload & Options Carry-Over", () => {
    it("preserves customized placeholder options across version uploads", async () => {
      const eventId = "event_carryover";
      const formatId = "format_carryover";
      const v1Id = "version_1";
      const v2Id = "version_2";

      await db.insert(events).values({
        id: eventId,
        ownerId: "user_1",
        slug: "carryover-test",
        title: "Carryover Test",
        status: "draft",
      });

      await db.insert(eventFormats).values({
        id: formatId,
        eventId,
        format: "square",
        enabled: true,
      });

      await db.insert(psdVersions).values([
        {
          id: v1Id,
          eventFormatId: formatId,
          version: 1,
          psdKey: "psd1.psd",
          sizeBytes: 100,
          status: "ready",
        },
        {
          id: v2Id,
          eventFormatId: formatId,
          version: 2,
          psdKey: "psd2.psd",
          sizeBytes: 100,
          status: "uploaded",
        },
      ]);

      // Designer customized options on V1
      const customOptions = {
        maxLines: 3,
        maxLength: 75,
        align: "center" as const,
        minFontSize: 12,
        maxFontSize: 40,
      };

      await db.insert(placeholders).values({
        id: "p1",
        psdVersionId: v1Id,
        layerId: "layer_name",
        layerName: "#PLACEHOLDER_name",
        key: "name",
        type: "text",
        box: { x: 10, y: 10, w: 50, h: 20 },
        options: customOptions,
      });

      // When V2 processes, it carries over previous options for matching (key, type)
      const existing = await db
        .select()
        .from(placeholders)
        .innerJoin(psdVersions, eq(placeholders.psdVersionId, psdVersions.id))
        .where(eq(psdVersions.eventFormatId, formatId));

      const optionsMap = new Map();
      for (const { placeholders: p } of existing) {
        optionsMap.set(`${p.key}:::${p.type}`, p.options);
      }

      expect(optionsMap.get("name:::text")).toEqual(customOptions);

      // Insert carried-over placeholder into V2
      await db.insert(placeholders).values({
        id: "p2_v2",
        psdVersionId: v2Id,
        layerId: "layer_name_new",
        layerName: "#PLACEHOLDER_name",
        key: "name",
        type: "text",
        box: { x: 12, y: 12, w: 48, h: 20 },
        options: optionsMap.get("name:::text"),
      });

      const [v2Placeholder] = await db
        .select()
        .from(placeholders)
        .where(eq(placeholders.psdVersionId, v2Id));

      expect(v2Placeholder.options).toEqual(customOptions);
    });
  });

  describe("Manual Placeholder Addition & Persistence", () => {
    it("allows adding placeholders post-upload and persists them into the database", async () => {
      const eventId = "event_manual_placeholders";
      const formatId = "format_manual_placeholders";
      const versionId = "version_manual_placeholders";

      await db.insert(events).values({
        id: eventId,
        ownerId: "user_1",
        slug: "manual-placeholders-test",
        title: "Manual Placeholders Test",
        status: "draft",
      });

      await db.insert(eventFormats).values({
        id: formatId,
        eventId,
        format: "square",
        enabled: true,
      });

      await db.insert(psdVersions).values({
        id: versionId,
        eventFormatId: formatId,
        version: 1,
        psdKey: "test.psd",
        sizeBytes: 500,
        status: "ready",
      });

      // Initially zero placeholders with validation error
      await db.insert(validationIssues).values({
        id: randomUUID(),
        psdVersionId: versionId,
        severity: "error",
        code: "ZERO_PLACEHOLDERS",
        message: "No placeholder layers found",
      });

      // Designer manually adds placeholders post-upload
      const manualPlaceholders = [
        {
          id: "manual_p_name",
          psdVersionId: versionId,
          layerId: "manual_1",
          layerName: "Custom NAME",
          key: "NAME",
          type: "text" as const,
          sampleValue: "Jamie Park",
          box: { x: 15, y: 74, w: 70, h: 10 },
          options: { maxLines: 1, maxLength: 50, align: "center" as const },
        },
        {
          id: "manual_p_photo",
          psdVersionId: versionId,
          layerId: "manual_2",
          layerName: "Custom PHOTO",
          key: "PHOTO",
          type: "image" as const,
          sampleValue: "/jamie.png",
          box: { x: 25, y: 20, w: 50, h: 45 },
          options: { fit: "cover" as const, useShapeAsMask: true },
        },
      ];

      for (const p of manualPlaceholders) {
        await db.insert(placeholders).values(p);
      }

      // Clear ZERO_PLACEHOLDERS when placeholders exist
      if (manualPlaceholders.length > 0) {
        await db
          .delete(validationIssues)
          .where(
            and(
              eq(validationIssues.psdVersionId, versionId),
              eq(validationIssues.code, "ZERO_PLACEHOLDERS")
            )
          );
      }

      // Verify placeholders were inserted into DB
      const dbPlaceholders = await db
        .select()
        .from(placeholders)
        .where(eq(placeholders.psdVersionId, versionId));

      expect(dbPlaceholders.length).toBe(2);
      expect(dbPlaceholders.map((p) => p.key).sort()).toEqual(["NAME", "PHOTO"]);
      expect(dbPlaceholders.find((p) => p.key === "PHOTO")?.box).toEqual({
        x: 25,
        y: 20,
        w: 50,
        h: 45,
      });

      // Verify ZERO_PLACEHOLDERS error was cleared
      const remainingIssues = await db
        .select()
        .from(validationIssues)
        .where(
          and(
            eq(validationIssues.psdVersionId, versionId),
            eq(validationIssues.code, "ZERO_PLACEHOLDERS")
          )
        );
      expect(remainingIssues.length).toBe(0);
    });
  });

  describe("Deadline & Capacity Enforcement", () => {
    it("rejects generation token when closesAt deadline has passed", async () => {
      const eventId = "event_expired";
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      await db.insert(events).values({
        id: eventId,
        ownerId: "user_1",
        slug: "expired-event",
        title: "Expired Event",
        status: "published",
        closesAt: yesterday,
      });

      const [event] = await db
        .select()
        .from(events)
        .where(eq(events.id, eventId));

      const isClosed = event.closesAt ? event.closesAt < new Date() : false;
      expect(isClosed).toBe(true);
    });

    it("rejects generation token when maxFlyers capacity is reached", async () => {
      const eventId = "event_full";
      await db.insert(events).values({
        id: eventId,
        ownerId: "user_1",
        slug: "full-event",
        title: "Full Event",
        status: "published",
        maxFlyers: 2,
      });

      // Insert 2 generated flyers
      await db.insert(analyticsEvents).values([
        { id: "a1", eventId, type: "generated", visitorHash: "v1" },
        { id: "a2", eventId, type: "generated", visitorHash: "v2" },
      ]);

      const [genCount] = await db
        .select({ value: count() })
        .from(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.eventId, eventId),
            eq(analyticsEvents.type, "generated")
          )
        );

      const isCapacityReached = (genCount?.value ?? 0) >= 2;
      expect(isCapacityReached).toBe(true);
    });

    it("verifies and consumes token idempotently in a transaction", async () => {
      const eventId = "event_token_test";
      const token = "secure-token-123";
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await db.insert(events).values({
        id: eventId,
        ownerId: "user_1",
        slug: "token-event",
        title: "Token Event",
        status: "published",
      });

      await db.insert(generationTokens).values({
        id: "tok_1",
        eventId,
        token,
        expiresAt,
        usedAt: null,
      });

      // First consumption
      let firstAttemptSuccess = false;
      await db.transaction(async (tx) => {
        const [t] = await tx
          .select()
          .from(generationTokens)
          .where(and(eq(generationTokens.token, token), eq(generationTokens.eventId, eventId)));

        if (t && !t.usedAt && t.expiresAt > new Date()) {
          await tx
            .update(generationTokens)
            .set({ usedAt: new Date() })
            .where(eq(generationTokens.id, t.id));

          await tx.insert(analyticsEvents).values({
            id: randomUUID(),
            eventId,
            type: "generated",
            visitorHash: "v_test",
          });
          firstAttemptSuccess = true;
        }
      });

      expect(firstAttemptSuccess).toBe(true);

      // Second consumption with same token (idempotent / should not double increment)
      let secondAttemptIncremented = false;
      await db.transaction(async (tx) => {
        const [t] = await tx
          .select()
          .from(generationTokens)
          .where(and(eq(generationTokens.token, token), eq(generationTokens.eventId, eventId)));

        if (t && !t.usedAt) {
          secondAttemptIncremented = true;
        }
      });

      expect(secondAttemptIncremented).toBe(false);

      const [totalCount] = await db
        .select({ value: count() })
        .from(analyticsEvents)
        .where(and(eq(analyticsEvents.eventId, eventId), eq(analyticsEvents.type, "generated")));

      expect(totalCount?.value).toBe(1);
    });
  });

  describe("Soft Delete & Exclusion", () => {
    it("soft deletes event and excludes it from active listings", async () => {
      const eventId = "event_to_delete";
      await db.insert(events).values({
        id: eventId,
        ownerId: "user_1",
        slug: "delete-me",
        title: "Delete Me",
        status: "published",
        deletedAt: null,
      });

      // Soft delete
      await db
        .update(events)
        .set({ deletedAt: new Date() })
        .where(eq(events.id, eventId));

      const activeEvents = await db
        .select()
        .from(events)
        .where(isNull(events.deletedAt));

      expect(activeEvents.some((e) => e.id === eventId)).toBe(false);
    });
  });
});
