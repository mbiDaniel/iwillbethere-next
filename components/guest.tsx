"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { CalendarDays, LockKeyhole, Download, Share2, RotateCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { PhotoUploader } from "./files";
import { EmptyState } from "./shell";
import { dateLabel } from "@/lib/mock-data";
import type { Event, Placeholder } from "@/lib/types";
import { flyerManifestSchema, FlyerManifest } from "@/lib/flyer/types";
import { renderFlyer, exportFlyer } from "@/lib/flyer/render";
import { createCanvas, loadImageBitmap } from "@/lib/flyer/canvas";

export function Guest({
  slug: _propSlug,
  event,
}: {
  slug?: string;
  event?: Event | null;
}) {
  const [values, set] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [manifest, setManifest] = useState<FlyerManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetProgress, setAssetProgress] = useState(0);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewBitmapsRef = useRef<Map<string, any>>(new Map());
  const fullBitmapsRef = useRef<Map<string, any>>(new Map());
  const fullAssetsPrefetchedRef = useRef(false);

  const formStartedTracked = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  // Track anonymous visit on mount
  useEffect(() => {
    if (!event) return;
    const params = new URLSearchParams(window.location.search);
    const source = params.get("utm_source") || params.get("ref") || "direct";

    fetch(`/api/public/events/${event.slug}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "visit", source }),
    }).catch(() => {});
  }, [event?.slug]);

  // Step 1: Fetch and validate manifest
  useEffect(() => {
    if (!event?.manifestUrl) return;

    let cancelled = false;
    setLoadingManifest(true);

    fetch(event.manifestUrl)
      .then((res) => {
        if (!res.ok) throw new Error("Could not load flyer manifest");
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const parsed = flyerManifestSchema.safeParse(data);
        if (parsed.success) {
          setManifest(parsed.data);
        } else {
          console.warn("Manifest schema validation warnings:", parsed.error);
          setManifest(data as FlyerManifest);
        }
      })
      .catch((err) => {
        console.warn("Manifest fetch error:", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingManifest(false);
      });

    return () => {
      cancelled = true;
    };
  }, [event?.manifestUrl]);

  // Step 2: Fetch preview-tier slices and masks in parallel
  useEffect(() => {
    if (!manifest) return;

    let cancelled = false;
    setLoadingAssets(true);

    const previewItems = manifest.items
      .filter((i) => i.kind === "slice")
      .map((i: any) => ({
        key: i.assets.preview.key,
        url: i.assets.preview.url,
        sha256: i.assets.preview.sha256,
        bytes: i.assets.preview.bytes,
      }));

    for (const p of manifest.placeholders) {
      if (p.mask) {
        previewItems.push({
          key: p.mask.preview.key,
          url: p.mask.preview.url,
          sha256: p.mask.preview.sha256,
          bytes: p.mask.preview.bytes,
        });
      }
    }

    const totalBytes = previewItems.reduce((acc, it) => acc + (it.bytes || 50000), 0);
    let loadedBytes = 0;

    Promise.all(
      previewItems.map(async (item) => {
        try {
          const res = await fetch(item.url, { mode: "cors" });
          if (!res.ok) throw new Error(`Failed to fetch slice: ${res.statusText}`);
          const blob = await res.blob();
          const bitmap = await loadImageBitmap(blob);

          if (!cancelled) {
            previewBitmapsRef.current.set(item.key, bitmap);
            previewBitmapsRef.current.set(item.url, bitmap);
            previewBitmapsRef.current.set(item.sha256, bitmap);

            loadedBytes += item.bytes || blob.size;
            setAssetProgress(Math.min(100, Math.round((loadedBytes / totalBytes) * 100)));
          }
        } catch (fetchErr) {
          console.warn(`Error loading slice asset ${item.url}:`, fetchErr);
        }
      })
    ).finally(() => {
      if (!cancelled) {
        setLoadingAssets(false);
        // Trigger initial canvas render
        scheduleRender();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [manifest]);

  // Step 3: Lazy prefetch of full tier assets
  const prefetchFullTier = useCallback(async () => {
    if (!manifest || fullAssetsPrefetchedRef.current) return;
    fullAssetsPrefetchedRef.current = true;

    const fullItems = manifest.items
      .filter((i) => i.kind === "slice")
      .map((i: any) => ({
        key: i.assets.full.key,
        url: i.assets.full.url,
        sha256: i.assets.full.sha256,
      }));

    for (const p of manifest.placeholders) {
      if (p.mask) {
        fullItems.push({
          key: p.mask.full.key,
          url: p.mask.full.url,
          sha256: p.mask.full.sha256,
        });
      }
    }

    for (const item of fullItems) {
      if (!fullBitmapsRef.current.has(item.sha256)) {
        fetch(item.url, { mode: "cors" })
          .then((res) => (res.ok ? res.blob() : null))
          .then(async (blob) => {
            if (blob) {
              const bitmap = await loadImageBitmap(blob);
              fullBitmapsRef.current.set(item.key, bitmap);
              fullBitmapsRef.current.set(item.url, bitmap);
              fullBitmapsRef.current.set(item.sha256, bitmap);
            }
          })
          .catch(() => {});
      }
    }
  }, [manifest]);

  // Trigger full prefetch when user interacts or finishes first input
  useEffect(() => {
    if (Object.values(values).some(Boolean)) {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (window as any).requestIdleCallback(() => prefetchFullTier());
      } else {
        setTimeout(prefetchFullTier, 1000);
      }
    }
  }, [values, prefetchFullTier]);

  // Step 4: Render live preview onto canvas
  const scheduleRender = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(async () => {
      if (!manifest || !previewCanvasRef.current) return;

      const guestBitmaps: Record<string, any> = {};
      for (const [id, val] of Object.entries(values)) {
        if (!val) continue;
        if (val.startsWith("data:") || val.startsWith("blob:") || val.startsWith("/")) {
          try {
            const img = new Image();
            img.crossOrigin = "anonymous";
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              img.src = val;
            });
            guestBitmaps[id] = img;
          } catch {
            guestBitmaps[id] = val;
          }
        } else {
          guestBitmaps[id] = val;
        }
      }

      const canvas = previewCanvasRef.current;
      const tier = manifest.tiers.preview;
      canvas.width = tier.width;
      canvas.height = tier.height;

      await renderFlyer(
        {
          manifest,
          tier: "preview",
          assetBitmaps: previewBitmapsRef.current,
          guestValues: guestBitmaps,
          renderSamplesForEmpty: true,
        },
        canvas
      );
    });
  }, [manifest, values]);

  // Re-render when values change
  useEffect(() => {
    if (manifest && previewBitmapsRef.current.size > 0) {
      scheduleRender();
    }
  }, [values, manifest, scheduleRender]);

  if (!event)
    return (
      <EmptyState
        title="Event unavailable"
        description="This event is unpublished or the link is no longer available."
      />
    );

  const filled = event.placeholders.filter((p) => values[p.id]?.trim()).length;
  const total = event.placeholders.length;
  const ready = total > 0 && filled === total;

  const fill = (id: string, v: string) => {
    if (!formStartedTracked.current) {
      formStartedTracked.current = true;
      fetch(`/api/public/events/${event.slug}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "form_started" }),
      }).catch(() => {});
    }
    set((prev) => ({ ...prev, [id]: v }));
  };

  const handleExport = async (action: "Download PNG" | "Download JPEG" | "Share") => {
    setGenerating(true);
    try {
      // 1. Request generation token
      const tokenRes = await fetch(
        `/api/public/events/${event.slug}/generation-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: "square" }),
        }
      );

      if (!tokenRes.ok) {
        const errorData = await tokenRes.json().catch(() => ({}));
        toast.error(errorData.error || "Event personalization is closed.");
        setGenerating(false);
        return;
      }

      const { token } = await tokenRes.json();

      // 2. Ensure full tier assets are loaded
      await prefetchFullTier();

      // Decode guest photos for full tier export
      const guestExportValues: Record<string, any> = {};
      for (const [id, val] of Object.entries(values)) {
        if (!val) continue;
        if (val.startsWith("data:") || val.startsWith("blob:") || val.startsWith("/")) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = val;
          });
          guestExportValues[id] = img;
        } else {
          guestExportValues[id] = val;
        }
      }

      // 3. Render full tier flyer using exportFlyer
      let exportResult;
      const format = action === "Download JPEG" ? "image/jpeg" : "image/png";

      if (manifest) {
        // Merge full bitmaps with preview bitmaps as fallback
        const exportAssetMap = new Map<string, any>([
          ...previewBitmapsRef.current.entries(),
          ...fullBitmapsRef.current.entries(),
        ]);

        exportResult = await exportFlyer(
          {
            manifest,
            assetBitmaps: exportAssetMap,
            guestValues: guestExportValues,
          },
          { format, quality: 0.92 }
        );
      } else {
        throw new Error("Flyer manifest not loaded.");
      }

      // 4. Report generated flyer with token
      await fetch(`/api/public/events/${event.slug}/generated`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, format: "square" }),
      });

      // 5. Track action
      const eventType = action === "Share" ? "shared" : "downloaded";
      await fetch(`/api/public/events/${event.slug}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: eventType, format: "square" }),
      });

      // 6. Deliver to guest
      const filename = `${event.slug}-flyer.${format === "image/jpeg" ? "jpg" : "png"}`;
      const file = new File([exportResult.blob], filename, { type: format });

      if (action === "Share" && typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: event.title,
          text: `I will be at ${event.title}!`,
        });
        toast.success("Flyer shared!");
      } else {
        const objectUrl = URL.createObjectURL(exportResult.blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
        toast.success(
          exportResult.resized
            ? "Downloaded flyer (resized to fit your device's canvas limit)."
            : "Flyer downloaded in full resolution!"
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Export error";
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <span className="crumb">
        <CalendarDays size={16} />
        {event.date ? dateLabel(event.date) : "Event"}
      </span>
      <h1>{event.title}</h1>
      <p className="lead mb-7">{event.description}</p>

      <div className="dual">
        <div className="preview-bed">
          <div className="flyer">
            {/* Live rendered preview canvas */}
            <canvas
              ref={previewCanvasRef}
              className="poster"
              style={{
                width: "100%",
                height: "100%",
                display: manifest && !loadingAssets ? "block" : "none",
                objectFit: "contain",
              }}
            />

            {/* Clean preview fallback / skeleton while loading */}
            {(!manifest || loadingAssets) && (
              <img
                className="poster"
                alt={`${event.title} event artwork`}
                src={event.artwork}
              />
            )}

            <div className="stub">
              <span>I WILL BE THERE</span>
              <i aria-hidden="true" />
            </div>

            {/* Read-only interactive click-to-focus placeholder zones */}
            {event.placeholders.map((p) => {
              const b = p.box;
              const hasVal = Boolean(values[p.id]?.trim());
              return (
                <div
                  key={p.id}
                  className={`slot ${!hasVal ? "outlined" : ""}`}
                  style={{
                    left: b.x + "%",
                    top: b.y + "%",
                    width: b.w + "%",
                    height: b.h + "%",
                    borderRadius: p.type === "image" && p.options.useShapeAsMask ? "50%" : 0,
                    pointerEvents: "auto",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    const el = document.querySelector<HTMLInputElement>(`#field-${CSS.escape(p.id)} input`);
                    el?.focus();
                  }}
                  title={`Click to fill ${p.key}`}
                />
              );
            })}
          </div>

          {loadingAssets && (
            <div className="stack mt-2" style={{ width: "100%", maxWidth: "340px", margin: "10px auto 0" }}>
              <span className="hint" style={{ fontSize: "0.82rem", textAlign: "center" }}>
                Loading flyer graphics ({assetProgress}%)...
              </span>
              <progress
                value={assetProgress}
                max={100}
                style={{ width: "100%", height: "6px" }}
              />
            </div>
          )}
        </div>

        <section className="panel fields">
          <h2>Make it yours.</h2>
          <p>Add your details to the flyer. The design is already set.</p>

          <div className="row spread">
            <span role="status" className="hint">
              {filled} of {total} fields complete
            </span>
            {Object.values(values).some(Boolean) ? (
              <button
                className="underline"
                type="button"
                onClick={() => set({})}
              >
                Clear details
              </button>
            ) : (
              <button
                className="underline"
                type="button"
                onClick={() =>
                  set(
                    Object.fromEntries(
                      event.placeholders.map((p) => [
                        p.id,
                        p.type === "image"
                          ? "/jamie.png"
                          : (p.sampleValue || "Jamie Park").slice(
                              0,
                              p.options.maxLength ?? 40
                            ),
                      ])
                    )
                  )
                }
              >
                Try sample details
              </button>
            )}
          </div>

          {[...event.placeholders]
            .sort(
              (a, b) => Number(a.type === "image") - Number(b.type === "image")
            )
            .map((p) =>
              p.type === "text" ? (
                <label key={p.id} id={`field-${p.id}`}>
                  {p.key}
                  <input
                    maxLength={p.options.maxLength ?? 40}
                    placeholder={`Enter your ${p.key.toLowerCase()}`}
                    value={values[p.id] ?? ""}
                    onChange={(e) => fill(p.id, e.target.value)}
                  />
                  <small className="hint">
                    {values[p.id]?.length ?? 0} / {p.options.maxLength ?? 40}{" "}
                    characters
                  </small>
                </label>
              ) : (
                <div key={p.id} id={`field-${p.id}`}>
                  <PhotoUploader
                    name={p.key}
                    value={values[p.id] ?? ""}
                    onChange={(v) => fill(p.id, v)}
                  />
                </div>
              )
            )}

          <span className="hint bar-inline">
            <LockKeyhole size={15} /> Your name and photo stay on your device.
          </span>

          <div className="row">
            {(["Download PNG", "Download JPEG", "Share"] as const).map(
              (a, i) => (
                <Button
                  key={a}
                  variant={i ? "outline" : "default"}
                  disabled={!ready || generating}
                  onClick={() => handleExport(a)}
                >
                  {generating ? (
                    <span className="row" style={{ gap: "6px" }}>
                      <RotateCw size={14} className="animate-spin" /> Preparing...
                    </span>
                  ) : (
                    a
                  )}
                </Button>
              )
            )}
          </div>

          <div className="row spread mt-2">
            <a
              href={`/api/public/events/${event.slug}/calendar.ics`}
              className="hint bar-inline underline"
              download
            >
              <Download size={14} /> Add to calendar (.ics)
            </a>
          </div>

          <p aria-live="polite" className="hint">
            {ready
              ? "Your personalized flyer is ready for high-resolution export."
              : "Complete every field to unlock download and sharing."}
          </p>
        </section>
      </div>
    </>
  );
}
