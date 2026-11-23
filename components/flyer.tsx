"use client";

import { useEffect, useRef, useState } from "react";
import type { Event } from "@/lib/types";
import { ImagePlus } from "lucide-react";
import { FlyerManifest } from "@/lib/flyer/types";
import { renderFlyer } from "@/lib/flyer/render";

export function FlyerPreview({
  event,
  manifest: propManifest,
  values = {},
  sample = false,
  highlighted,
  onSelect,
  onFocusField,
}: {
  event: Event;
  manifest?: FlyerManifest | null;
  values?: Record<string, string>;
  sample?: boolean;
  highlighted?: string;
  onSelect?: (id: string) => void;
  onFocusField?: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manifest, setManifest] = useState<FlyerManifest | null>(propManifest || null);
  const [slicesLoaded, setSlicesLoaded] = useState(false);

  // If manifestUrl is on event and no propManifest, load it
  useEffect(() => {
    if (propManifest) {
      setManifest(propManifest);
      return;
    }
    if (event.manifestUrl) {
      fetch(event.manifestUrl)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.version === 1) {
            setManifest(data);
          }
        })
        .catch(() => {});
    }
  }, [propManifest, event.manifestUrl]);

  // Load preview slices into memory and draw onto canvas
  useEffect(() => {
    if (!manifest || !canvasRef.current) return;

    let cancelled = false;
    const tier = manifest.tiers.preview;
    const canvas = canvasRef.current;
    canvas.width = tier.width;
    canvas.height = tier.height;

    const assetBitmaps = new Map<string, HTMLImageElement>();
    const sliceItems = manifest.items.filter((i) => i.kind === "slice");

    if (sliceItems.length === 0) return;

    let loadedCount = 0;
    const totalToLoad = sliceItems.length;

    sliceItems.forEach((item) => {
      if (item.kind !== "slice") return;
      const ref = item.assets.preview;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (cancelled) return;
        assetBitmaps.set(ref.key, img);
        assetBitmaps.set(ref.url, img);
        assetBitmaps.set(ref.sha256, img);
        loadedCount++;

        if (loadedCount === totalToLoad) {
          // Render only slices onto this background canvas
          renderFlyer(
            {
              manifest: {
                ...manifest,
                placeholders: [], // do not draw placeholders on background canvas; interactive HTML slots handle them
              },
              tier: "preview",
              assetBitmaps,
              guestValues: {},
            },
            canvas
          ).then(() => {
            if (!cancelled) setSlicesLoaded(true);
          });
        }
      };
      img.onerror = () => {
        loadedCount++;
      };
      img.src = ref.url;
    });

    return () => {
      cancelled = true;
    };
  }, [manifest]);

  return (
    <div className="flyer">
      {manifest && (
        <canvas
          ref={canvasRef}
          className="poster"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: slicesLoaded ? "block" : "none",
            objectFit: "contain",
          }}
        />
      )}

      {(!manifest || !slicesLoaded) && (
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

      {event.placeholders.map((p, i) => {
        const value = values[p.id] ?? (sample ? p.sampleValue : "");
        const b = p.box;
        const fontSize = p.options.fontSize ?? p.options.maxFontSize ?? 28;
        return (
          <div
            key={p.id}
            className={`slot ${!value || onSelect ? "outlined" : ""} ${highlighted === p.id ? "highlighted" : ""}`}
            style={{
              left: b.x + "%",
              top: b.y + "%",
              width: b.w + "%",
              height: b.h + "%",
              borderRadius:
                p.type === "image" && p.options.useShapeAsMask ? "50%" : 0,
              textAlign: p.options.align,
              alignContent: "center",
              fontSize: `${Math.min(fontSize / 3.4, (95 * (p.options.maxLines ?? 1)) / Math.max(value?.length ?? 1, 1))}cqw`,
              fontFamily: p.options.fallbackFont,
              whiteSpace: (p.options.maxLines ?? 1) > 1 ? "normal" : "nowrap",
            }}
          >
            {p.type === "image" ? (
              value ? (
                <img
                  alt="Guest portrait"
                  src={value}
                  style={{ objectFit: p.options.fit }}
                />
              ) : (
                <ImagePlus size="48%" />
              )
            ) : (
              value || `Your ${p.key.toLowerCase()}`
            )}
            {onFocusField && (
              <button
                type="button"
                className="field-jump"
                aria-label={`Go to ${p.key} field`}
                onClick={() => onFocusField(p.id)}
              />
            )}
            {onSelect && (
              <button
                className="box-select"
                aria-label={`Select ${p.key}`}
                onClick={() => onSelect(p.id)}
              >
                {i + 1}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
