# I Will Be There

A UI-only event flyer studio using Next.js App Router, React, strict TypeScript, Tailwind and shadcn/ui. No environment variables or external services are required. Use the project's shadcn CLI download or GitHub checkout, install dependencies with `pnpm install`, then start with `npm run dev`.

## Try it

- `/`: landing page. `/guide`: design guide.
- `/e/after-hours`: published example; `/e/open-studio` or an unknown slug: unavailable state.
- `/login`, `/signup`: validated demo forms, no accounts or sessions. Do not enter real credentials.
- `/dashboard`: sample events; duplicate, edit, copy links, delete with confirmation. Delete both samples to see the empty state.
- `/dashboard/events/new`: four-step wizard. Use the sample PSD or select any `.psd`; no bytes are parsed. Use an unmatched prefix to see the zero-layer warning; repeat keys to trigger a duplicate warning.
- `/dashboard/events/after-hours`: overview, placeholders, fonts and settings.

### Interactive walkthrough

On the guest page, select a flyer slot to focus its field, or choose **Try sample details** to see a completed flyer without choosing a personal photo. **Clear details** resets the form. Download and Share remain simulated.

At the wizard review step, choose **Save as draft** or **Publish**. The event overview lets you unpublish and republish the same guest link within the session. In the Placeholders section, **Save layer changes** applies valid edits to the guest form; **Discard changes** restores the last saved settings. Leaving the section discards unsaved edits.

## Structure and defaults

`app/` contains route wrappers, layout, route states, and CSS. `components/` contains the mock event context, public and designer controls; `components/ui/` contains installed shadcn primitives. `lib/types.ts` defines the replacement data contract; `lib/mock-data.ts` seeds the two events. `public/` holds bundled fonts and artwork. Display: Space Grotesk; body: DM Sans, served via next/font/local.

State lasts only while navigating within the current tab; refreshing resets it. Newly created links therefore work inside this demo session, not across devices. Sample links are stable. Share and download show toasts, not exported files. The QR symbol is illustrative. Guest photos are read only into memory, with JPG/PNG/WebP and a 10 MB limit. No canvas, uploads, API routes or server actions. The flyer uses fixed percentage-positioned HTML overlays and approximate CSS text fitting. Previewed fonts are fallbacks; uploaded font names are simulated from filenames.

## TODO: wire to backend

| File | Integration point |
| --- | --- |
| `components/store.tsx` | Replace seeded event reads and in-memory mutations (create, edit, duplicate, delete, font and layer settings) with authenticated persistence. |
| `components/auth-form.tsx` | Replace demo navigation with authentication. |
| `components/wizard.tsx` | Replace fake PSD upload/progress and sample artwork. Implement publishing, durable public links and real QR codes. |
| `components/placeholders.tsx` | Replace prefix filtering on fixtures with PSD layer discovery and validation. |
| `components/event-detail.tsx` | Validate fonts, resolve metadata, and track real font availability. |
| `components/guest.tsx` | Implement private device-side export and sharing; keep portrait and name local. |

Run `pnpm exec tsc --noEmit` for strict type checking. For a manual check: personalize the published sample, remove its photo, verify exports disable, then create a sample event and follow its guest link without refreshing.
