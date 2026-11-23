"use client";

import { useState } from "react";
import { ArrowRight, ImageIcon, Layers3, Search, Type, X } from "lucide-react";
import type { ManualPlaceholderMapping, PsdLayerDescriptor } from "@/lib/flyer/detect";

type LayerChoice = Omit<ManualPlaceholderMapping, "layerPath">;

function defaultChoice(layer: PsdLayerDescriptor, index: number): LayerChoice {
  const normalizedName = layer.name
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
  const key = normalizedName.slice(0, 50) || `SLOT_${index + 1}`;
  const type = layer.type ?? (/photo|image|avatar|picture|logo/i.test(key) ? "image" : "text");
  return { key, type };
}

export function ManualPlaceholderPicker({
  layers,
  busy,
  onStart,
}: {
  layers: PsdLayerDescriptor[];
  busy: boolean;
  onStart: (mappings: ManualPlaceholderMapping[]) => void;
}) {
  const [choices, setChoices] = useState<Record<string, LayerChoice>>({});
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  const selectedPaths = Object.keys(choices);
  const normalizedKeys = selectedPaths.map((path) => choices[path].key.trim().toUpperCase());
  const hasInvalidKeys = normalizedKeys.some(
    (key, index) => !key || normalizedKeys.indexOf(key) !== index
  );

  const compositeThumbnail =
    (layers as any).compositeThumbnail ||
    layers.find((l) => l.compositeThumbnail)?.compositeThumbnail;

  const maxRight = Math.max(1, ...layers.map((l) => l.right));
  const maxBottom = Math.max(1, ...layers.map((l) => l.bottom));

  const filteredLayers = layers.filter((layer) => {
    if (!searchFilter.trim()) return true;
    const term = searchFilter.toLowerCase().trim();
    return (
      layer.name.toLowerCase().includes(term) ||
      (layer.textPreview && layer.textPreview.toLowerCase().includes(term))
    );
  });

  function updateChoice(layer: PsdLayerDescriptor, index: number, changes: Partial<LayerChoice>) {
    setChoices((current) => {
      const existing = current[layer.layerPath] ?? defaultChoice(layer, index);
      return { ...current, [layer.layerPath]: { ...existing, ...changes } };
    });
  }

  function toggleLayer(layer: PsdLayerDescriptor, index: number, checked: boolean) {
    setChoices((current) => {
      if (!checked) {
        const next = { ...current };
        delete next[layer.layerPath];
        return next;
      }
      return {
        ...current,
        [layer.layerPath]: current[layer.layerPath] ?? defaultChoice(layer, index),
      };
    });
  }

  return (
    <section className="panel stack" aria-labelledby="manual-placeholder-title" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <Layers3 size={20} aria-hidden="true" style={{ marginTop: 2 }} />
        <div className="stack" style={{ gap: 4 }}>
          <h3 id="manual-placeholder-title">Choose placeholder layers</h3>
          <p className="hint">
            This PSD has no tagged placeholders. Select the layers guests should be able to replace,
            then set a unique key and content type for each. The original PSD stays unchanged.
          </p>
        </div>
      </div>

      <div className={`manual-picker-layout ${compositeThumbnail ? "has-flyer-preview" : ""}`}>
        {/* Flyer Overview with Highlight Boxes */}
        {compositeThumbnail && (
          <aside className="manual-picker-flyer-pane">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--muted-foreground)",
                }}
              >
                Flyer Overview
              </span>
              {selectedPaths.length > 0 && (
                <span className="hint" style={{ fontSize: 11, fontWeight: 600 }}>
                  {selectedPaths.length} selected
                </span>
              )}
            </div>

            <div
              className="flyer-overview-wrapper"
              style={{ aspectRatio: `${maxRight} / ${maxBottom}` }}
            >
              <img
                src={compositeThumbnail}
                alt="Flyer composite overview"
                className="flyer-overview-img"
              />
              {layers.map((layer) => {
                const isSelected = !!choices[layer.layerPath];
                const isHovered = hoveredPath === layer.layerPath;
                if (!isSelected && !isHovered) return null;
                const leftPct = (layer.left / maxRight) * 100;
                const topPct = (layer.top / maxBottom) * 100;
                const widthPct = Math.max(1, ((layer.right - layer.left) / maxRight) * 100);
                const heightPct = Math.max(1, ((layer.bottom - layer.top) / maxBottom) * 100);
                return (
                  <div
                    key={layer.layerPath}
                    className={`flyer-layer-box ${isHovered ? "is-hovered" : ""} ${isSelected ? "is-selected" : ""}`}
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${widthPct}%`,
                      height: `${heightPct}%`,
                    }}
                  >
                    {isHovered && <span className="flyer-layer-tag">{layer.name}</span>}
                  </div>
                );
              })}
            </div>
            <p className="hint" style={{ fontSize: 11, textAlign: "center", margin: 0 }}>
              Hover over or select layers to see their position on the flyer.
            </p>
          </aside>
        )}

        {/* Layers List */}
        <div className="stack" style={{ gap: 12, minWidth: 0 }}>
          {layers.length > 6 && (
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <div
                className="row"
                style={{
                  flex: 1,
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "6px 10px",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Search size={15} style={{ color: "var(--muted-foreground)" }} />
                <input
                  type="text"
                  placeholder="Filter layers by name or text…"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    outline: "none",
                    width: "100%",
                    fontSize: 13,
                    padding: 0,
                  }}
                />
                {searchFilter && (
                  <button
                    type="button"
                    onClick={() => setSearchFilter("")}
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 2,
                      cursor: "pointer",
                      display: "flex",
                      color: "var(--muted-foreground)",
                    }}
                    aria-label="Clear filter"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <span className="hint" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                {filteredLayers.length} of {layers.length}
              </span>
            </div>
          )}

          {filteredLayers.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {filteredLayers.map((layer, index) => {
                const choice = choices[layer.layerPath];
                const isHovered = hoveredPath === layer.layerPath;
                return (
                  <div
                    key={layer.layerPath}
                    className={`layer-item ${choice ? "is-selected" : ""} ${isHovered ? "is-hovered" : ""}`}
                    style={{ display: "grid", gap: 8 }}
                    onMouseEnter={() => setHoveredPath(layer.layerPath)}
                    onMouseLeave={() => setHoveredPath(null)}
                  >
                    <div className="row" style={{ gap: 12, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        id={`chk_${layer.layerPath}`}
                        checked={!!choice}
                        onChange={(event) => toggleLayer(layer, index, event.target.checked)}
                        aria-label={`Select layer ${layer.name}`}
                        style={{ cursor: "pointer" }}
                      />

                      {/* Visual Layer Thumbnail Preview */}
                      <div className="layer-thumb-box" title={layer.name}>
                        {layer.thumbnail ? (
                          <img
                            src={layer.thumbnail}
                            alt={layer.name}
                            className="layer-thumb-img"
                            loading="lazy"
                          />
                        ) : (
                          <div className="layer-thumb-fallback">
                            {layer.type === "text" ? <Type size={18} /> : <ImageIcon size={18} />}
                          </div>
                        )}
                      </div>

                      <label
                        htmlFor={`chk_${layer.layerPath}`}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          cursor: "pointer",
                          display: "grid",
                          gap: 3,
                        }}
                      >
                        <div
                          className="row"
                          style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}
                        >
                          <strong style={{ overflowWrap: "anywhere" }}>{layer.name}</strong>
                          <span
                            className={`layer-type-pill ${
                              layer.type === "image" ? "image-type" : "text-type"
                            }`}
                          >
                            {layer.type === "image" ? <ImageIcon size={11} /> : <Type size={11} />}
                            {layer.type === "image" ? "Image" : "Text"}
                          </span>
                        </div>
                        <div
                          className="row"
                          style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}
                        >
                          <span className="hint">
                            {Math.round(layer.right - layer.left)} ×{" "}
                            {Math.round(layer.bottom - layer.top)} px
                          </span>
                          {layer.textPreview && (
                            <span className="layer-text-preview" title={layer.textPreview}>
                              &ldquo;{layer.textPreview}&rdquo;
                            </span>
                          )}
                        </div>
                      </label>
                    </div>

                    {choice && (
                      <div className="fields opts" style={{ paddingLeft: 34 }}>
                        <label>
                          Placeholder key
                          <input
                            value={choice.key}
                            maxLength={50}
                            onChange={(event) =>
                              updateChoice(layer, index, { key: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Content type
                          <select
                            value={choice.type}
                            onChange={(event) =>
                              updateChoice(layer, index, {
                                type: event.target.value === "image" ? "image" : "text",
                              })
                            }
                          >
                            <option value="text">Text</option>
                            <option value="image">Image</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="notice warn">
              {searchFilter
                ? `No layers matching "${searchFilter}".`
                : "No visible artwork layers were found in this PSD."}
            </p>
          )}

          {hasInvalidKeys && selectedPaths.length > 0 && (
            <p role="alert" className="notice warn">
              Each selected layer needs a unique, non-empty key.
            </p>
          )}

          <button
            type="button"
            className="btn primary"
            disabled={busy || !selectedPaths.length || hasInvalidKeys}
            onClick={() =>
              onStart(
                selectedPaths.map((layerPath) => ({ layerPath, ...choices[layerPath] }))
              )
            }
            style={{ alignSelf: "flex-start", marginTop: 8 }}
          >
            <ArrowRight size={16} />
            {busy
              ? "Preparing PSD…"
              : `Slice with ${selectedPaths.length} selected layer${
                  selectedPaths.length === 1 ? "" : "s"
                }`}
          </button>
        </div>
      </div>
    </section>
  );
}
