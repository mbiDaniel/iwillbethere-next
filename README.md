# I Will Be There — Backend & Studio

"I Will Be There" is a personalized event flyer studio built with **Next.js App Router**, **React 19**, **strict TypeScript**, **Tailwind CSS**, and **shadcn/ui**. It turns designer Photoshop (`.psd`) artwork into personalized, shareable event flyers for every attendee while preserving original typography, layer hierarchy, and privacy.

---

## 🏗️ Architecture & Fixed Stack

- **Auth:** [Better Auth](https://www.better-auth.com/) with Drizzle adapter (`pg` provider), email + password, and magic link authentication. Mounted at `/api/auth/[...all]`.
- **Database & ORM:** PostgreSQL with [Drizzle ORM](https://orm.drizzle.team/) and `drizzle-kit` schema migrations.
- **Storage:** Cloudflare R2 (S3-compatible API) via `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
  - **Private bucket:** Original PSD backups for designer re-scanning (never accessible to guests).
  - **Public bucket:** Render slices, image masks, manifests (`manifest.json`), and custom event fonts (with `Cache-Control: public, max-age=31536000, immutable`).
- **Browser-Side PSD Slicer:** Client-side Web Worker parses PSDs with `ag-psd` (`OffscreenCanvas`), detects placeholders (`#PLACEHOLDER_`), and slices artwork into merged, trimmed PNGs (preview & full resolution tiers).
- **Client-Side Flyer Composition:** Guest browser downloads small slices & manifest (<2.5MB preview budget), swaps placeholder text & photos, merges everything on HTML/Offscreen canvas, and exports full-resolution PNG/JPEG.
- **Validation:** Strict schema validation with [Zod](https://zod.dev/) (`flyerManifestSchema`) and deterministic validation issue codes.
- **Testing:** [Vitest](https://vitest.dev/) for unit and integration testing (64 tests across 12 suites), and [Playwright](https://playwright.dev/) for end-to-end flows.

---

## 🔒 Core Privacy & Security Principles

1. **Guest privacy:** Guest names and photos are **never** sent to or stored on the server. No backend endpoint accepts guest personal content. The guest personalization stays entirely in the attendee's browser memory.
2. **Guests change content only:** Flyer geometry, placeholder positioning, font choices, styling, fitting, and masks are locked in the designer's PSD configuration and are immutable to guests.
3. **Never trust PSD content:** Layer names and text strings from PSDs are treated as untrusted inputs. They are sanitized, escaped on output, and never used in raw SQL, HTML injection, or storage path generation.
4. **Server-side ownership verification:** Every mutation Server Action and Route Handler strictly invokes `requireUser()` and `requireEventOwner(eventId)`. Middleware redirects are not the sole security barrier.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js `v20+` or `v22+`
- `pnpm` (v10+ or v12+)
- Docker & Docker Compose (or an external PostgreSQL 16+ instance)

### 2. Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure your `.env`:
```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iwillbethere"
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/iwillbethere_test"

# Better Auth
BETTER_AUTH_SECRET="change-this-to-a-very-secure-random-secret-key-at-least-32-chars"
BETTER_AUTH_URL="http://localhost:3000"

# Cloudflare R2 Storage (S3-compatible API)
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET_PRIVATE="iwillbethere-private"
R2_BUCKET_PUBLIC="iwillbethere-public"
R2_PUBLIC_BASE_URL="http://localhost:3000/api/public/assets"

# Email Provider (console in dev, resend in production)
EMAIL_PROVIDER="console"
RESEND_API_KEY=""

# Daily secret salt for anonymous visitor hash rotation
DAILY_ANALYTICS_SECRET="daily-analytics-salt-secret-key-rotating"

# Node Environment
NODE_ENV="development"
```

### 3. Start Local PostgreSQL
Start development and test databases:
```bash
docker compose up -d
```

### 4. Run Migrations & Seed
Run database migrations and seed sample demo data:
```bash
pnpm db:migrate
pnpm db:seed
```

Demo designer credentials:
- **Email:** `designer@iwillbethere.com`
- **Password:** `Password123!`

### 5. Run the Application
Start the Next.js development server:
```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000).

---

## 📦 NPM Scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Starts Next.js development server |
| `pnpm build` | Builds the production application with webpack compiler |
| `pnpm start` | Starts Next.js in production mode |
| `pnpm db:generate` | Generates Drizzle SQL migrations from schema |
| `pnpm db:migrate` | Applies migrations to the database |
| `pnpm db:seed` | Seeds demo designer, published event, slices, and sample analytics |
| `pnpm db:studio` | Opens Drizzle Studio GUI |
| `pnpm fixtures` | Generates synthetic test PSD files in `tests/fixtures/` |
| `pnpm test` | Runs all Vitest unit and integration tests |
| `pnpm test:e2e` | Runs Playwright end-to-end browser tests |

---

## 🪣 Cloudflare R2 & Storage Setup

The system operates with two distinct storage buckets:

### 1. Private Bucket (`R2_BUCKET_PRIVATE`)
Stores original uploaded Photoshop files (`.psd`). Files are accessible only via short-lived presigned URLs or direct server read operations.

**CORS Configuration (Private Bucket):**
Required to allow the browser to directly PUT large PSD files to Cloudflare R2:
```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>http://localhost:3000</AllowedOrigin>
    <AllowedOrigin>https://yourdomain.com</AllowedOrigin>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
```

### 2. Public Bucket (`R2_BUCKET_PUBLIC`)
Stores immutable render slices, alpha masks, downscaled previews (`clean.png` and `designer.png`), font files, and `manifest.json`.

**CORS Configuration (Public Bucket):**
```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>http://localhost:3000</AllowedOrigin>
    <AllowedOrigin>https://yourdomain.com</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>86400</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
```

---

## 🎨 Browser-Side PSD Slicing & Flyer Composition

Guests never download the raw PSD (which can exceed 50–100+ MB). Instead, the designer's browser parses and slices the PSD into trimmed PNGs, and the guest's browser composes their flyer on an HTML5 canvas.

### Pipeline Flow

1. **Pre-flight & Safety:** Verifies magic bytes (`8BPS`), rejects PSB files, and enforces size ($\le 100$ MB) and dimension bounds ($\le 10,000$ px per side and $\le 100$ megapixels).
2. **Web Worker Parsing (`ag-psd`):** Unzips layer data in a background Web Worker with `OffscreenCanvas`, reporting progress events (`reading`, `detecting`, `slicing`, `encoding`).
3. **Placeholder Detection:** Scans the layer hierarchy for layers prefixed with `#PLACEHOLDER_`. Sanitizes keys and infers types:
   - Keys with `photo`, `image`, `avatar`, `pic`, or `logo` $\to$ `image`.
   - All other keys $\to$ `text`.
   - Existing designer customizations carry over automatically on re-scan.
4. **Layer Flattening Bottom-to-Top:**
   - Hidden layers and groups are skipped.
   - Clipping masks and layer masks (`destination-in`, `source-atop`) are rasterized.
   - Supported blend modes map to 2D canvas `globalCompositeOperation`.
5. **Merged Slicing:**
   - Consecutive non-placeholder layers are merged into a single slice.
   - A new slice starts only when a placeholder is encountered, strictly preserving z-order.
   - Each slice is trimmed to its non-transparent bounding box `(x, y, w, h)`.
6. **Dual-Tier Encoding & Deduplication:**
   - `full`: native-resolution PNG for the final guest export.
   - `preview`: downscaled (~1200 px wide) for lightning-fast live editing on phones.
   - SHA-256 content hashes are calculated for each asset via Web Crypto (`crypto.subtle.digest`) for content-addressing and deduplication.
7. **Alpha Masks:** Shape/transparency pixels of image placeholders are rendered to PNG masks trimmed to the placeholder bounds.
8. **Fidelity Verification:** The recomposited flyer is compared against the PSD's embedded composite image using `pixelmatch` on a downscaled copy to produce a fidelity score ($0.0 \dots 1.0$).
9. **Direct R2 Upload & Server Commit:**
   - Slices and masks upload directly from the designer's browser to Cloudflare R2 using presigned URLs with automatic retry and a proxy fallback.
   - The server validates the manifest schema, inspects asset prefixes, checks file sizes and PNG magic bytes, and commits the version.

---

### Manifest Format Specification (Version 1)

```typescript
interface FlyerManifest {
  version: 1;
  width: number;            // Full canvas width in PSD pixels
  height: number;           // Full canvas height in PSD pixels
  tiers: {
    preview: Tier;          // Lightweight tier for live phone editing (~1200px wide)
    full: Tier;             // Native resolution tier for final export
  };
  items: ManifestItem[];    // Ordered bottom-to-top draw order
  placeholders: ManifestPlaceholder[];
  fonts: ManifestFont[];
  fidelity?: { score: number; method: "pixel-diff"; warnings: string[] };
  generator: { app: string; psdLayerCount: number; createdAt: string };
}

interface Tier {
  scale: number;            // 1 for full, e.g. 0.4 for preview
  width: number;
  height: number;
  totalBytes: number;
}

type ManifestItem =
  | {
      kind: "slice";
      id: string;
      x: number; y: number; w: number; h: number; // Native-res canvas offsets
      assets: { preview: AssetRef; full: AssetRef };
    }
  | {
      kind: "placeholder";
      placeholderId: string;
      inheritedOpacity?: number;
    };

interface AssetRef {
  key: string;
  url: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  contentType: "image/png" | "image/webp";
}

interface ManifestPlaceholder {
  id: string;
  key: string;
  type: "text" | "image";
  layerName: string;
  box: { x: number; y: number; w: number; h: number };
  options: {
    maxLines?: number;
    maxLength?: number;
    align?: "left" | "center" | "right";
    minFontSize?: number;
    maxFontSize?: number;
    fit?: "cover" | "contain";
    useShapeAsMask?: boolean;
    framingMode?: "center" | "top-center" | "face-aware" | "focal";
    focalPoint?: { x: number; y: number };
    sampleValue?: string;
  };
  textStyle?: {
    fontFamily: string;
    fontWeight?: number;
    fontStyle?: "normal" | "italic";
    fontSize: number;
    color: string;
    lineHeight?: number;
    tracking?: number;
    direction?: "ltr" | "rtl";
  };
  mask?: { preview: AssetRef; full: AssetRef };
}

interface ManifestFont {
  family: string;
  weight?: number;
  style?: string;
  url?: string;
  missing: boolean;
}
```

---

### 📱 Browser Canvas Limits & iOS Safari Handling

- **Area Budget:** iOS Safari enforces an approximate limit of **16.7 megapixels (4096×4096 px)** on standard `<canvas>` allocations. Attempting to allocate larger canvases results in immediate silent crashes or blank exports.
- **Automatic Downscaling:** The client export engine (`exportFlyer` in `lib/flyer/render.ts`) detects when canvas dimensions exceed 16.7 MP and calculates a scaled export factor that maximizes resolution within memory safety limits.
- **Allocation Retry:** If canvas allocation throws an out-of-memory exception during native export, the renderer catches the error, halves the resolution scale, and retries gracefully, notifying the guest.

---

### 🎨 Photoshop Feature Support Matrix

| Feature | Support Status | Slicer Behavior |
| --- | --- | --- |
| **Normal Layers & Groups** | Supported | Merged into contiguous slices |
| **Layer Opacity & Fill** | Supported | Rasterized into slice canvas |
| **Clipping Masks** | Supported | Rendered using `source-atop` compositing |
| **Layer Masks** | Supported | Applied using `destination-in` alpha channel |
| **16 Standard Blend Modes** | Supported | Mapped to `globalCompositeOperation` (`multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`) |
| **Layer Effects (Drop Shadow, Stroke, Glow)** | Requires Rasterization | Emits `LAYER_EFFECT_NOT_REPRODUCED` warning naming the layer; designers are advised to rasterize the effect in Photoshop before export |
| **Isolated Groups with Blend/Masks** | Warning Emitted | Inherited group opacity is tracked; complex blend modes raise `PLACEHOLDER_IN_ISOLATED_GROUP` |
| **Slice Count Budget** | Warning if $> 12$ | Emits `SLICE_COUNT_HIGH` if interleaved placeholders create excessive HTTP requests |

---

## 🚦 Soft Enforcement (Deadline & Capacity)

The guest page requests a short-lived **generation token** (`POST /api/public/events/[slug]/generation-token`) prior to enabling export.
- Rejection occurs if `closesAt` has passed or if `maxFlyers` capacity is reached.
- Once exported, the client calls `POST .../generated` with the token. The server marks the token consumed in a database transaction and records an anonymous counter increment.
- **Caveat:** Because flyer rendering occurs inside the user's browser, determined technical users could theoretically bypass client-side export gates once asset slices are fetched. This represents intentional **soft enforcement** designed for high throughput without server rendering bottlenecks.

---

## 📊 Anonymous Analytics

- **No PII:** IP addresses, browser fingerprints, attendee names, and guest photos are never recorded.
- **Daily-Rotating Visitor Hash:** `visitorHash = HMAC-SHA256(ip + userAgent + eventId + date + DAILY_ANALYTICS_SECRET)`. Visits are deduplicated per visitor per event per day, and hashes are mathematically unlinkable across days.
- **Allowlisted Sources:** UTM sources are normalized against an allowlist (`whatsapp`, `instagram`, `x`, `facebook`, `direct`, `other`).

---

## ✅ Integration Points (TODO Resolution)

| Original File | Status | Implementation Details |
| --- | --- | --- |
| `components/store.tsx` | **Resolved** | Replaced mock session arrays with database-backed Server Component data providers and Server Actions. |
| `components/auth-form.tsx` | **Resolved** | Integrated Better Auth client (`authClient.signIn`, `signUp`, and `magicLink`) with email verification and rate limiting. |
| `components/wizard.tsx` | **Resolved** | Wired direct presigned R2 upload, PostgreSQL queue polling via TanStack Query, live placeholder extraction, publishing, and real SVG QR codes. |
| `components/placeholders.tsx` | **Resolved** | Connected real layer discovery, server-side re-scan, options carry-over, and validation error reporting. |
| `components/event-detail.tsx` | **Resolved** | Wired font upload & magic-byte verification, live validation issues gating, event settings mutation, and draft unpublishing. |
| `components/guest.tsx` | **Resolved** | Wired published manifest loading, anonymous telemetry (`visit`, `form_started`, `downloaded`, `shared`), generation token validation, and calendar export (`.ics`). |

### Explicitly Deferred Items
- **Browser Canvas High-Res Renderer:** Phase 2 implementation. The UI's CSS-overlay preview is fully operational against real manifest and slice data. The export button hook records the generation token and logs the canvas renderer placeholder.
- **Client-Side Face Detection:** Scheduled for Phase 2.
- **Billing & Subscription Plans:** Out of scope for this milestone.
