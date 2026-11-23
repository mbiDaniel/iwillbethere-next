"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown, PlusCircle, RotateCw, Trash2 } from "lucide-react";
import { FlyerPreview } from "./flyer";
import type { Event, Placeholder, PlaceholderOptions } from "@/lib/types";
import { slots } from "@/lib/mock-data";
import { toast } from "sonner";
import { FidelityCard } from "./flyer-fidelity";
import { DownloadWeightCard } from "./download-weight";
import { ValidationReport } from "./validation-report";
import { FlyerManifest } from "@/lib/flyer/types";
import { MissingFontsPanel } from "./missing-fonts";

function NumericTextInput({
  label,
  value,
  min,
  max,
  integer = false,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  integer?: boolean;
  onCommit: (value: number) => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(String(value));
    setError("");
  }, [value]);

  function validateAndCommit() {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    const validNumber = /^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed) && Number.isFinite(parsed);
    const validInteger = !integer || Number.isInteger(parsed);

    if (!validNumber || !validInteger || parsed < min || parsed > max) {
      setError(
        integer
          ? `Enter a whole number from ${min} to ${max}.`
          : `Enter a number from ${min} to ${max}.`
      );
      return;
    }

    setError("");
    setDraft(String(parsed));
    onCommit(parsed);
  }

  return (
    <label htmlFor={inputId}>
      {label}
      <input
        id={inputId}
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        value={draft}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError("");
        }}
        onBlur={validateAndCommit}
      />
      {error && (
        <span
          id={`${inputId}-error`}
          role="alert"
          style={{ color: "var(--danger)", fontSize: "0.82rem" }}
        >
          {error}
        </span>
      )}
    </label>
  );
}

export function PlaceholderOptionsPanel({
  p,
  update,
  onRemove,
}: {
  p: Placeholder;
  update: (p: Placeholder) => void;
  onRemove?: (id: string) => void;
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
              ["maxLength", "Max characters", 1, 500],
              ["fontSize", "Font size", 6, 120],
            ] as const
          ).map(([key, label, min, max]) => (
            <NumericTextInput
              key={`${p.id}-${key}`}
              label={label}
              value={
                p.options[key] ??
                (key === "fontSize"
                  ? p.options.maxFontSize ?? p.options.minFontSize ?? 28
                  : min)
              }
              min={min}
              max={max}
              integer
              onCommit={(value) =>
                key === "fontSize"
                  ? opts({ fontSize: value, minFontSize: undefined, maxFontSize: undefined })
                  : opts({ [key]: value })
              }
            />
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

      {/* Position & Dimensions on canvas (percent) */}
      <div style={{ gridColumn: "1 / -1", paddingTop: "0.25rem" }}>
        <span className="hint" style={{ fontWeight: 600 }}>
          Canvas Position & Size (%)
        </span>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: "8px",
            marginTop: "6px",
          }}
        >
          <NumericTextInput
            key={`${p.id}-x`}
            label="X (%)"
            value={p.box?.x ?? 0}
            min={0}
            max={95}
            onCommit={(x) => update({ ...p, box: { ...p.box, x } })}
          />
          <NumericTextInput
            key={`${p.id}-y`}
            label="Y (%)"
            value={p.box?.y ?? 0}
            min={0}
            max={95}
            onCommit={(y) => update({ ...p, box: { ...p.box, y } })}
          />
          <NumericTextInput
            key={`${p.id}-width`}
            label="Width (%)"
            value={p.box?.w ?? 50}
            min={5}
            max={100}
            onCommit={(w) => update({ ...p, box: { ...p.box, w } })}
          />
          <NumericTextInput
            key={`${p.id}-height`}
            label="Height (%)"
            value={p.box?.h ?? 10}
            min={2}
            max={100}
            onCommit={(h) => update({ ...p, box: { ...p.box, h } })}
          />
        </div>
      </div>

      {onRemove && (
        <div style={{ gridColumn: "1 / -1", paddingTop: "0.5rem" }}>
          <button
            type="button"
            className="btn danger small"
            onClick={() => onRemove(p.id)}
          >
            <Trash2 size={14} /> Remove this placeholder
          </button>
        </div>
      )}

      <p className="notice">
        These settings are locked for guests. They can only change the content.
      </p>
    </div>
  );
}

export function PlaceholderList({
  event,
  manifest,
  validationIssues = [],
  fidelityScore,
  compositeUrl,
  previewUrl,
  onChange,
  onRescan,
  onUseFlattenedFallback,
}: {
  event: Event;
  manifest?: FlyerManifest | null;
  validationIssues?: any[];
  fidelityScore?: number | null;
  compositeUrl?: string | null;
  previewUrl?: string | null;
  onChange: (list: Placeholder[]) => void;
  onRescan?: (prefix: string) => Promise<void> | void;
  onUseFlattenedFallback?: () => Promise<void> | void;
}) {
  const [prefix, setPrefix] = useState("#PLACEHOLDER_");
  const [selected, select] = useState(event.placeholders[0]?.id || "");
  const [hover, setHover] = useState("");
  const [rescanning, setRescanning] = useState(false);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [customType, setCustomType] = useState<"text" | "image">("text");
  const [customPreset, setCustomPreset] = useState("center");

  const list = event.placeholders;

  const handleAddPlaceholder = (
    key: string,
    type: "text" | "image",
    preset: string = "center"
  ) => {
    const cleanKey =
      key.trim().toUpperCase() || (type === "image" ? "PHOTO" : "NAME");

    if (list.some((p) => p.key.trim().toUpperCase() === cleanKey)) {
      toast.error(`Key "${cleanKey}" already exists. Choose a unique key.`);
      return;
    }

    let box = { x: 15, y: 40, w: 70, h: 12 };
    let useShapeAsMask = false;

    if (preset === "name_bottom") {
      box = { x: 15, y: 74, w: 70, h: 10 };
    } else if (preset === "top") {
      box = { x: 10, y: 12, w: 80, h: 10 };
    } else if (preset === "photo_portrait") {
      box = { x: 25, y: 20, w: 50, h: 45 };
      useShapeAsMask = false;
    } else if (preset === "photo_circle") {
      box = { x: 35, y: 22, w: 30, h: 25 };
      useShapeAsMask = true;
    } else if (preset === "center") {
      box =
        type === "image"
          ? { x: 25, y: 25, w: 50, h: 40 }
          : { x: 15, y: 45, w: 70, h: 12 };
      if (type === "image") useShapeAsMask = true;
    }

    const newId = `placeholder-${Date.now()}`;
    const newPlaceholder: Placeholder = {
      id: newId,
      layerName: `Custom ${cleanKey}`,
      key: cleanKey,
      type,
      sampleValue: type === "image" ? "/jamie.png" : "Jamie Park",
      box,
      options: {
        maxLines: type === "text" ? 1 : undefined,
        maxLength: type === "text" ? 50 : undefined,
        align: "center",
        fontSize: 32,
        fallbackFont: "Arial",
        fit: type === "image" ? "cover" : undefined,
        useShapeAsMask,
      },
    };

    const updated = [...list, newPlaceholder];
    onChange(updated);
    select(newId);
    setIsAddingCustom(false);
    setCustomKey("");
    toast.success(`Placeholder "${cleanKey}" added.`);
  };

  const handleRemove = (id: string) => {
    const updated = list.filter((p) => p.id !== id);
    onChange(updated);
    if (selected === id) {
      select(updated[0]?.id ?? "");
    }
    toast.info("Placeholder removed.");
  };

  const sliceItems = manifest?.items.filter((i) => i.kind === "slice") as any[] || [];
  const slicesData = sliceItems.map((s) => ({
    id: s.id,
    previewBytes: s.assets?.preview?.bytes,
    fullBytes: s.assets?.full?.bytes,
    w: s.w,
    h: s.h,
  }));

  const effectiveFidelity =
    fidelityScore !== undefined && fidelityScore !== null
      ? fidelityScore
      : manifest?.fidelity?.score ?? 1.0;

  return (
    <div className="stack" style={{ gap: "16px" }}>
      {/* Fidelity card */}
      <FidelityCard
        fidelityScore={effectiveFidelity}
        compositeUrl={compositeUrl}
        previewUrl={previewUrl || event.artwork}
        manifest={manifest}
        warnings={manifest?.fidelity?.warnings}
        onUseFlattenedFallback={onUseFlattenedFallback}
      />

      {/* Download weight card */}
      <DownloadWeightCard
        totalPreviewBytes={manifest?.tiers.preview.totalBytes}
        totalFullBytes={manifest?.tiers.full.totalBytes}
        sliceCount={sliceItems.length}
        slices={slicesData}
      />

      {/* Validation Report */}
      <ValidationReport issues={validationIssues} />

      {/* Missing fonts from manifest */}
      {manifest?.fonts && manifest.fonts.length > 0 && (
        <MissingFontsPanel
          fonts={manifest.fonts}
          eventId={event.id}
        />
      )}

      {/* Re-scan controls */}
      <div className="fields panel row spread" style={{ alignItems: "center" }}>
        <label style={{ flex: 1 }}>
          Layer prefix
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="#PLACEHOLDER_"
          />
        </label>
        <button
          type="button"
          className="btn secondary"
          disabled={rescanning}
          style={{ marginTop: "18px" }}
          onClick={async () => {
            if (onRescan) {
              setRescanning(true);
              try {
                await onRescan(prefix);
              } finally {
                setRescanning(false);
              }
            } else {
              toast.info(`Scanning with prefix ${prefix}`);
            }
          }}
        >
          <RotateCw size={15} className={rescanning ? "animate-spin" : ""} />
          {rescanning ? "Downloading PSD & re-scanning..." : "Re-scan PSD"}
        </button>
      </div>

      {/* Add Placeholder Panel */}
      <div
        className="panel stack"
        style={{
          background: "var(--muted)",
          border: "1.5px dashed var(--border)",
          padding: "16px",
        }}
      >
        <div className="row spread">
          <div className="row" style={{ gap: "8px" }}>
            <PlusCircle size={17} />
            <strong>Add placeholder slot</strong>
          </div>
          {isAddingCustom && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setIsAddingCustom(false)}
            >
              Cancel
            </button>
          )}
        </div>

        {!isAddingCustom ? (
          <div className="row wrap" style={{ gap: "8px" }}>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => handleAddPlaceholder("NAME", "text", "name_bottom")}
            >
              + Guest Name (Text)
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => handleAddPlaceholder("PHOTO", "image", "photo_circle")}
            >
              + Guest Photo (Image)
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                setCustomKey("");
                setCustomType("text");
                setIsAddingCustom(true);
              }}
            >
              + Custom Placeholder...
            </button>
          </div>
        ) : (
          <div className="fields opts" style={{ marginTop: "4px" }}>
            <label>
              Key Name
              <input
                placeholder="e.g. MESSAGE, TITLE, PHOTO"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Type
              <select
                value={customType}
                onChange={(e) => {
                  const t = e.target.value === "image" ? "image" : "text";
                  setCustomType(t);
                  setCustomPreset(t === "image" ? "photo_circle" : "center");
                }}
              >
                <option value="text">Text (Name, Quote, Title)</option>
                <option value="image">Image (Guest Photo, Logo)</option>
              </select>
            </label>
            <label>
              Placement Preset
              <select
                value={customPreset}
                onChange={(e) => setCustomPreset(e.target.value)}
              >
                {customType === "text" ? (
                  <>
                    <option value="name_bottom">Bottom Name (x:15%, y:74%)</option>
                    <option value="center">Center (x:15%, y:45%)</option>
                    <option value="top">Top Header (x:10%, y:12%)</option>
                  </>
                ) : (
                  <>
                    <option value="photo_circle">Circle Avatar (x:35%, y:22%)</option>
                    <option value="photo_portrait">Center Portrait (x:25%, y:20%)</option>
                    <option value="center">Center Square (x:25%, y:25%)</option>
                  </>
                )}
              </select>
            </label>
            <button
              type="button"
              className="btn primary small"
              disabled={!customKey.trim()}
              onClick={() => handleAddPlaceholder(customKey, customType, customPreset)}
            >
              Add to flyer
            </button>
          </div>
        )}
      </div>

      {!list.length && (
        <p className="notice warn">
          No placeholders yet. Click one of the buttons above to add one.
        </p>
      )}

      <div className="dual">
        <div className="preview-bed">
          <FlyerPreview
            event={event}
            manifest={manifest}
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
              <div
                className="row spread"
                style={{ width: "100%", paddingRight: "8px" }}
              >
                <button
                  type="button"
                  className="layer-head row spread"
                  style={{ flex: 1 }}
                  aria-expanded={selected === p.id}
                  onClick={() => select(selected === p.id ? "" : p.id)}
                >
                  <span>
                    {i + 1}. {p.layerName || p.key}
                  </span>
                  <ChevronDown size={16} />
                </button>
                <button
                  type="button"
                  className="iconbtn danger"
                  title={`Remove ${p.key}`}
                  style={{ width: "30px", height: "30px", marginLeft: "6px" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(p.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="hint">
                {p.type === "text" ? "Text" : "Image"} / {p.key || "No key"}
              </p>
              {selected === p.id && (
                <PlaceholderOptionsPanel
                  p={p}
                  update={(next) =>
                    onChange(list.map((s) => (s.id === next.id ? next : s)))
                  }
                  onRemove={handleRemove}
                />
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
