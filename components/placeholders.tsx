"use client";
import { useState } from "react";
import { ChevronDown, RotateCw } from "lucide-react";
import { FlyerPreview } from "./flyer";
import type { Event, Placeholder, PlaceholderOptions } from "@/lib/types";
import { slots } from "@/lib/mock-data";
import { toast } from "sonner";
export function PlaceholderOptionsPanel({
  p,
  update,
}: {
  p: Placeholder;
  update: (p: Placeholder) => void;
}) {
  const opts = (v: Partial<PlaceholderOptions>) =>
    update({ ...p, options: { ...p.options, ...v } });
  return (
    <div className="fields opts">
      <label>
        Key
        <input
          value={p.key}
          onChange={(e) => update({ ...p, key: e.target.value })}
        />
      </label>
      <label>
        Type
        <select
          value={p.type}
          onChange={(e) => {
            const type = e.target.value === "image" ? "image" : "text";
            update({
              ...p,
              type,
              sampleValue: type === "image" ? "/jamie.png" : "Jamie Park",
              options: { ...slots.find((s) => s.type === type)!.options },
            });
          }}
        >
          <option value="text">Text</option>
          <option value="image">Image</option>
        </select>
      </label>
      {p.type === "text" ? (
        <>
          {(
            [
              ["maxLines", "Max lines", 1, 4],
              ["maxLength", "Max characters", 1, 160],
              ["minFontSize", "Min font size", 6, p.options.maxFontSize ?? 28],
              ["maxFontSize", "Max font size", p.options.minFontSize ?? 9, 72],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                value={p.options[key] ?? min}
                onChange={(e) =>
                  opts({
                    [key]: Math.max(min, Math.min(max, Number(e.target.value))),
                  })
                }
              />
            </label>
          ))}
          <label>
            Alignment
            <select
              value={p.options.align}
              onChange={(e) =>
                opts({ align: e.target.value as PlaceholderOptions["align"] })
              }
            >
              {["left", "center", "right"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Fallback font
            <select
              value={p.options.fallbackFont}
              onChange={(e) => opts({ fallbackFont: e.target.value })}
            >
              {["Arial", "Georgia", "Verdana"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <label>
            Image fit
            <select
              value={p.options.fit}
              onChange={(e) =>
                opts({
                  fit: e.target.value === "contain" ? "contain" : "cover",
                })
              }
            >
              <option>cover</option>
              <option>contain</option>
            </select>
          </label>
          <label>
            Use layer shape as mask
            <input
              type="checkbox"
              role="switch"
              checked={!!p.options.useShapeAsMask}
              onChange={(e) => opts({ useShapeAsMask: e.target.checked })}
            />
          </label>
        </>
      )}
      <p className="notice">
        These settings are locked for guests. They can only change the content.
      </p>
    </div>
  );
}
export function PlaceholderList({
  event,
  onChange,
}: {
  event: Event;
  onChange: (list: Placeholder[]) => void;
}) {
  const [prefix, setPrefix] = useState("#PLACEHOLDER_"),
    [selected, select] = useState("name"),
    [hover, setHover] = useState("");
  const list = event.placeholders;
  return (
    <div className="stack">
      <div className="fields panel">
        <label>
          Layer prefix
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </label>
        <button
          className="btn secondary"
          onClick={() => {
            // TODO: wire to backend — discover actual PSD layers instead of filtering fixtures.
            const detected = prefix
              ? slots
                  .filter((p) => p.layerName.startsWith(prefix))
                  .map((p) => ({ ...p, key: p.layerName.slice(prefix.length) }))
              : [];
            onChange(detected);
            select(detected[0]?.id ?? "");
            toast.info(`${detected.length} placeholders found`);
          }}
        >
          <RotateCw size={15} />
          Re-scan layers
        </button>
      </div>
      {!list.length && (
        <p className="notice warn">
          No placeholders found. Try #PLACEHOLDER_ and re-scan.
        </p>
      )}
      {new Set(list.map((p) => p.key.trim())).size < list.length && (
        <p role="alert" className="notice warn">
          Duplicate key. Give each layer a unique key.
        </p>
      )}
      {list.some((p) => p.type === "text") && !event.fonts.length && (
        <p className="notice warn">
          Missing font: Studio Grotesk. The preview uses the fallback font.
        </p>
      )}
      <div className="dual">
        <div className="preview-bed">
          <FlyerPreview
            event={event}
            sample
            highlighted={hover || selected}
            onSelect={select}
          />
        </div>
        <div className="stack">
          {list.map((p, i) => (
            <section
              key={p.id}
              className="layer-item"
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover("")}
            >
              <button
                className="layer-head row spread"
                aria-expanded={selected === p.id}
                onClick={() => select(selected === p.id ? "" : p.id)}
              >
                <span>
                  {i + 1}. {p.layerName}
                </span>
                <ChevronDown size={16} />
              </button>
              <p className="hint">
                {p.type === "text" ? "Text" : "Image"} / {p.key || "No key"}
              </p>
              {selected === p.id && (
                <PlaceholderOptionsPanel
                  p={p}
                  update={(next) =>
                    onChange(list.map((s) => (s.id === next.id ? next : s)))
                  }
                />
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
