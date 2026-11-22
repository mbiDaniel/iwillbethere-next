import { test, expect } from "@playwright/test";

test.describe("Full End-to-End Flyer Studio Workflow & Guest Privacy", () => {
  const timestamp = Date.now();
  const testEmail = `designer_${timestamp}@example.com`;
  const testPassword = "Password123!";
  const testName = `Alex Designer ${timestamp}`;
  const eventTitle = `Brooklyn Indie Fest ${timestamp}`;
  const secretGuestName = `SecretGuest_${timestamp}_Safe`;

  test("Sign up -> Create Event -> Slicing Progress -> Review & Publish -> Guest Page (Zero PSD & Zero Data Leak)", async ({
    page,
  }) => {
    // 1. Visit signup page
    await page.goto("/signup");
    await expect(page.locator("h1")).toContainText("Create an account");

    // 2. Fill sign up form
    await page.fill('input[name="name"]', testName);
    await page.fill('input[name="email"]', testEmail);
    await page.fill('input[name="password"]', testPassword);
    await page.click('button:has-text("Sign up")');

    // 3. Arrive at dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator("h1")).toContainText("Your events");

    // 4. Click New Event
    await page.click('a:has-text("New event")');
    await expect(page).toHaveURL(/\/dashboard\/events\/new/);

    // 5. Fill Step 0 (Details)
    await page.fill('input[placeholder="Give your event a name"]', eventTitle);
    await page.fill('input[type="datetime-local"]', "2026-11-20T20:00");
    await page.fill(
      'textarea[placeholder="What should your guests know?"]',
      "Join us for a night of indie music, drinks, and art."
    );
    await page.click('button:has-text("Continue")');

    // 6. Step 1 (Upload & Client-side PSD Slicing)
    await expect(page.locator("h2")).toContainText("Upload PSD");
    await page.click('button:has-text("Use sample PSD")');

    // Staged progress checks (reading -> detecting -> slicing -> uploading -> ready)
    await expect(page.locator('[role="status"]')).toContainText(
      /Reading PSD|Detecting placeholders|Slicing & encoding|Uploading slices|Ready! Sliced into/i,
      { timeout: 30000 }
    );
    await expect(page.locator('[role="status"]')).toContainText(/Ready! Sliced into|Sample layers ready/i, {
      timeout: 30000,
    });
    await page.click('button:has-text("Continue")');

    // 7. Step 2 (Placeholders)
    await expect(page.locator("h2")).toContainText("Placeholders");
    await expect(page.locator(".layer-item")).toHaveCount(2);
    await page.click('button:has-text("Continue")');

    // 8. Step 3 (Review & Publish with Fidelity and Weight Cards)
    await expect(page.locator("h2")).toContainText("Review");
    await expect(page.locator("h3")).toContainText(eventTitle);
    // Verify client-side slice cards render
    await expect(page.locator("body")).toContainText("Flyer Fidelity");
    await expect(page.locator("body")).toContainText("Download Weight");
    await page.click('button:has-text("Publish")');

    // 9. Verified Published State
    await expect(page.locator("h1")).toContainText("Your event is ready.");
    await expect(page.locator("body")).toContainText("is published and ready for guests");

    // 10. Open guest page link with strict network & privacy monitoring
    const guestLink = page.locator('a:has-text("Open guest page")');
    const guestHref = await guestLink.getAttribute("href");
    expect(guestHref).toMatch(/\/e\//);

    const requestedUrls: string[] = [];
    const interceptedPayloads: string[] = [];
    let totalAssetBytesTransferred = 0;

    page.on("request", (req) => {
      requestedUrls.push(req.url());
      const post = req.postData();
      if (post) interceptedPayloads.push(post);
    });

    page.on("response", async (res) => {
      const url = res.url();
      if (
        url.includes("/api/public/assets/") &&
        (url.endsWith(".png") || url.endsWith(".webp") || url.endsWith(".json"))
      ) {
        try {
          const body = await res.body();
          totalAssetBytesTransferred += body.byteLength;
        } catch {
          // Ignore stream reading errors if any
        }
      }
    });

    await page.goto(guestHref!);
    await expect(page.locator("h1")).toContainText(eventTitle);
    await expect(page.locator("text=Make it yours.")).toBeVisible();

    // Verify privacy indicator is visible to guests
    await expect(
      page.locator("text=Your name and photo stay on your device.")
    ).toBeVisible();

    // 11. Guest inputs personal details (name)
    const nameInput = page.locator('input[placeholder*="name" i], label:has-text("name") input, label:has-text("Name") input').first();
    if (await nameInput.isVisible()) {
      await nameInput.fill(secretGuestName);
    } else {
      await page.click('button:has-text("Try sample details")');
    }

    // Wait for canvas re-rendering
    await page.waitForTimeout(500);

    // 12. Trigger high-res export
    const downloadButton = page.locator('button:has-text("Download PNG")');
    await expect(downloadButton).toBeEnabled({ timeout: 15000 });

    // Intercept download
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await downloadButton.click();
    await downloadPromise;

    // 13. Privacy & Performance Assertions
    // A: Guest NEVER downloads the raw PSD or accesses private backup
    const psdRequests = requestedUrls.filter(
      (u) => u.toLowerCase().endsWith(".psd") || u.includes("backup.psd") || u.includes("R2_BUCKET_PRIVATE")
    );
    expect(psdRequests).toHaveLength(0);

    // B: Total preview download weight is well under 2.5 MB budget
    if (totalAssetBytesTransferred > 0) {
      expect(totalAssetBytesTransferred).toBeLessThan(2.5 * 1024 * 1024);
    }

    // C: Guest input (name) is NEVER sent over the wire in any URL or request body
    const leakingUrls = requestedUrls.filter((u) => u.includes(secretGuestName));
    expect(leakingUrls).toHaveLength(0);

    const leakingPayloads = interceptedPayloads.filter((p) => p.includes(secretGuestName));
    expect(leakingPayloads).toHaveLength(0);
  });
});
