"use client";

import { useState, useRef, useEffect } from "react";
import { CheckCircle2, AlertTriangle, Eye, Split, Layers } from "lucide-react";
import pixelmatch from "pixelmatch";
import { createCanvas } from "@/lib/flyer/canvas";

export function FidelityCard({
  fidelityScore,
  compositeUrl,
  previewUrl,
  warnings = [],
  onUseFlattenedFallback,
}: {
  fidelityScore?: number | null;
  compositeUrl?: string | null;
  previewUrl?: string | null;
  warnings?: string[];
  onUseFlattenedFallback?: () => void;
}) {
  const [showCompare, setShowCompare] = useState(false);
  const [compareMode, setCompareMode] = useState<"side-by-side" | "diff">("side-by-side");
  const diffCanvasRef = useRef<HTMLCanvasElement>(null);

  const scorePct = fidelityScore !== undefined && fidelityScore !== null ? Math.round(fidelityScore * 100) : 100;
  const isLowFidelity = scorePct < 85;

  useEffect(() => {
    if (!showCompare || compareMode !== "diff" || !compositeUrl || !previewUrl) return;

    let cancelled = false;
    const imgA = new Image();
    const imgB = new Image();
    imgA.crossOrigin = "anonymous";
    imgB.crossOrigin = "anonymous";

    let loaded = 0;
    const onLoad = () => {
      loaded++;
      if (loaded === 2 && !cancelled && diffCanvasRef.current) {
        const w = 400;
        const h = 400;
        const cA = createCanvas(w, h);
        const cB = createCanvas(w, h);
        const ctxA = cA.getContext("2d");
        const ctxB = cB.getContext("2d");

        ctxA.drawImage(imgA, 0, 0, w, h);
        ctxB.drawImage(imgB, 0, 0, w, h);

        const dataA = ctxA.getImageData(0, 0, w, h).data;
        const dataB = ctxB.getImageData(0, 0, w, h).data;

        const outCanvas = diffCanvasRef.current;
        outCanvas.width = w;
        outCanvas.height = h;
        const outCtx = outCanvas.getContext("2d");
        if (outCtx) {
          const diffImgData = outCtx.createImageData(w, h);
          pixelmatch(dataA, dataB, diffImgData.data, w, h, { threshold: 0.15 });
          outCtx.putImageData(diffImgData, 0, 0);
        }
      }
    };

    imgA.onload = onLoad;
    imgB.onload = onLoad;
    imgA.src = compositeUrl;
    imgB.src = previewUrl;

    return () => {
      cancelled = true;
    };
  }, [showCompare, compareMode, compositeUrl, previewUrl]);

  return (
    <div
      className="panel stack"
      style={{
        border: isLowFidelity ? "1.5px solid #f59e0b" : "1px solid var(--border)",
        background: isLowFidelity ? "rgba(245, 158, 11, 0.05)" : "var(--card)",
      }}
    >
      <div className="row spread" style={{ alignItems: "center" }}>
        <div className="row" style={{ gap: "10px", alignItems: "center" }}>
          {isLowFidelity ? (
            <AlertTriangle size={20} className="text-amber-500" />
          ) : (
            <CheckCircle2 size={20} className="text-emerald-500" />
          )}
          <div>
            <strong>Visual Fidelity: {scorePct}%</strong>
            <span className="hint" style={{ display: "block" }}>
              {isLowFidelity
                ? "Discrepancies detected between PSD composite and sliced layers."
                : "High fidelity. Sliced graphics faithfully match the PSD composite."}
            </span>
          </div>
        </div>

        {compositeUrl && previewUrl && (
          <button
            type="button"
            className="btn secondary small"
            onClick={() => setShowCompare(!showCompare)}
          >
            <Eye size={14} />
            {showCompare ? "Hide compare" : "Compare view"}
          </button>
        )}
      </div>

      {warnings.length > 0 && (
        <div style={{ marginTop: "4px" }}>
          {warnings.map((w, i) => (
            <p key={i} className="hint text-amber-500" style={{ margin: "2px 0" }}>
              • {w}
            </p>
          ))}
        </div>
      )}

      {isLowFidelity && onUseFlattenedFallback && (
        <div
          className="row spread"
          style={{
            background: "rgba(245, 158, 11, 0.1)",
            padding: "10px 14px",
            borderRadius: "8px",
            alignItems: "center",
            marginTop: "6px",
          }}
        >
          <div>
            <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
              Flattened fallback available
            </span>
            <p className="hint" style={{ margin: 0 }}>
              Export the PSD composite as a single background slice with placeholders drawn on top. Note: layers above placeholders will be covered.
            </p>
          </div>
          <button
            type="button"
            className="btn ghost small"
            onClick={onUseFlattenedFallback}
            style={{ whiteSpace: "nowrap" }}
          >
            <Layers size={14} />
            Use flattened fallback
          </button>
        </div>
      )}

      {showCompare && compositeUrl && previewUrl && (
        <div
          className="panel stack"
          style={{
            marginTop: "12px",
            background: "var(--background)",
            border: "1px solid var(--border)",
            padding: "14px",
            borderRadius: "8px",
          }}
        >
          <div className="row spread" style={{ alignItems: "center" }}>
            <span style={{ fontWeight: 600 }}>Compare Flyer vs Original PSD</span>
            <div className="row" style={{ gap: "6px" }}>
              <button
                type="button"
                className={`btn small ${compareMode === "side-by-side" ? "primary" : "secondary"}`}
                onClick={() => setCompareMode("side-by-side")}
              >
                <Split size={13} /> Side-by-side
              </button>
              <button
                type="button"
                className={`btn small ${compareMode === "diff" ? "primary" : "secondary"}`}
                onClick={() => setCompareMode("diff")}
              >
                Difference overlay
              </button>
            </div>
          </div>

          {compareMode === "side-by-side" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "12px",
                marginTop: "10px",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <span className="hint" style={{ fontWeight: 600 }}>Original PSD Composite</span>
                <img
                  src={compositeUrl}
                  alt="Original PSD composite"
                  style={{
                    width: "100%",
                    maxHeight: "300px",
                    objectFit: "contain",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    marginTop: "6px",
                    background: "#111",
                  }}
                />
              </div>
              <div style={{ textAlign: "center" }}>
                <span className="hint" style={{ fontWeight: 600 }}>Recomposited Flyer</span>
                <img
                  src={previewUrl}
                  alt="Recomposited flyer"
                  style={{
                    width: "100%",
                    maxHeight: "300px",
                    objectFit: "contain",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    marginTop: "6px",
                    background: "#111",
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", marginTop: "10px" }}>
              <span className="hint" style={{ fontWeight: 600 }}>
                Pixel Difference (Red highlights visual discrepancies)
              </span>
              <div style={{ marginTop: "6px" }}>
                <canvas
                  ref={diffCanvasRef}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "300px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: "#000",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
