"use client";

import { useState } from "react";
import { ArrowRight, Layers3 } from "lucide-react";
import type { ManualPlaceholderMapping, PsdLayerDescriptor } from "@/lib/flyer/detect";

type LayerChoice = Omit<ManualPlaceholderMapping, "layerPath">;

function defaultChoice(layer: PsdLayerDescriptor, index: number): LayerChoice {
  const normalizedName = layer.name
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
  const key = normalizedName.slice(0, 50) || `SLOT_${index + 1}`;
  const type = /photo|image|avatar|picture|logo/i.test(key) ? "image" : "text";
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
  const selectedPaths = Object.keys(choices);
  const normalizedKeys = selectedPaths.map((path) => choices[path].key.trim().toUpperCase());
  const hasInvalidKeys = normalizedKeys.some((key, index) => !key || normalizedKeys.indexOf(key) !== index);

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
      return { ...current, [layer.layerPath]: current[layer.layerPath] ?? defaultChoice(layer, index) };
    });
  }

  return (
    <section className="panel stack" aria-labelledby="manual-placeholder-title">
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <Layers3 size={20} aria-hidden="true" />
        <div className="stack" style={{ gap: 4 }}>
          <h3 id="manual-placeholder-title">Choose placeholder layers</h3>
          <p className="hint">
            This PSD has no tagged placeholders. Select the layers guests should be able to replace, then set a unique key and content type for each. The original PSD stays unchanged.
          </p>
        </div>
      </div>

      {layers.length ? (
        <div className="stack" style={{ gap: 8 }}>
          {layers.map((layer, index) => {
            const choice = choices[layer.layerPath];
            return (
              <div
                key={layer.layerPath}
                className="layer-item"
                style={{ display: "grid", gap: 8 }}
              >
                <label className="row" style={{ gap: 10, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={!!choice}
                    onChange={(event) => toggleLayer(layer, index, event.target.checked)}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{layer.name}</strong>
                    <span className="hint" style={{ display: "block" }}>
                      {Math.round(layer.right - layer.left)} × {Math.round(layer.bottom - layer.top)} px
                    </span>
                  </span>
                </label>
                {choice && (
                  <div className="fields opts" style={{ paddingLeft: 30 }}>
                    <label>
                      Placeholder key
                      <input
                        value={choice.key}
                        maxLength={50}
                        onChange={(event) => updateChoice(layer, index, { key: event.target.value })}
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
        <p className="notice warn">No visible artwork layers were found in this PSD.</p>
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
      >
        <ArrowRight size={16} />
        {busy ? "Preparing PSD…" : `Slice with ${selectedPaths.length} selected layer${selectedPaths.length === 1 ? "" : "s"}`}
      </button>
    </section>
  );
}
