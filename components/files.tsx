"use client";
import { useState } from "react";
import { Upload, Camera, Sparkles, Undo2, CheckCircle2, RotateCw, Wand2 } from "lucide-react";
import { removeBackground, applyPhotoStyle, PhotoStylePreset } from "@/lib/flyer/photo-style";
import { createCanvas, loadImageBitmap, canvasToDataUrl } from "@/lib/flyer/canvas";

export function FileDropzone({
  label,
  accept,
  hint,
  onFile,
}: {
  label: string;
  accept: string;
  hint: string;
  onFile: (f: File) => void;
}) {
  return (
    <div
      className="drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <Upload size={23} />
      <strong>{label}</strong>
      <span className="hint">{hint}</span>
      <input
        type="file"
        aria-label={label}
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function PhotoUploader({
  name,
  value,
  onChange,
  defaultStyle = "flyer-match",
  defaultBottomFade = 25,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  defaultStyle?: PhotoStylePreset;
  defaultBottomFade?: number;
}) {
  const [error, setError] = useState("");
  const [rawOriginal, setRawOriginal] = useState<string>("");
  const [bgRemoved, setBgRemoved] = useState(false);
  const [processingBg, setProcessingBg] = useState(false);
  const [activeStyle, setActiveStyle] = useState<PhotoStylePreset>(defaultStyle);
  const [bottomFade, setBottomFade] = useState<number>(defaultBottomFade);
  const [tolerance, setTolerance] = useState<number>(42);
  const [showSensitivity, setShowSensitivity] = useState(false);

  async function applyTransforms(
    baseSrc: string,
    isCutout: boolean,
    style: PhotoStylePreset,
    fade: number,
    tol: number
  ) {
    try {
      let current = baseSrc;
      if (isCutout) {
        current = await removeBackground(baseSrc, { tolerance: tol, feather: 8 });
      }
      if (style !== "none" || fade > 0) {
        const img = await loadImageBitmap(current);
        const w = img.width || 400;
        const h = img.height || 400;
        const canvas = createCanvas(w, h);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        applyPhotoStyle(canvas, { style, bottomFade: fade });
        current = await canvasToDataUrl(canvas, "image/png");
      }
      onChange(current);
    } catch (err: any) {
      console.warn("Transform photo error:", err);
      setError("Could not process photo: " + (err.message || String(err)));
    }
  }

  function choose(f: File) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
      f.size > 10 * 1024 * 1024
    ) {
      setError("Choose a JPG, PNG, or WebP under 10 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setError("");
      const originalDataUrl = String(reader.result);
      setRawOriginal(originalDataUrl);
      setBgRemoved(false);
      await applyTransforms(originalDataUrl, false, activeStyle, bottomFade, tolerance);
    };
    reader.onerror = () =>
      setError("This photo could not be read. Try another file.");
    reader.readAsDataURL(f);
  }

  async function handleToggleBgRemoval() {
    if (!rawOriginal && value) {
      setRawOriginal(value);
    }
    const sourceToUse = rawOriginal || value;
    if (!sourceToUse) return;

    if (bgRemoved) {
      // Restore original
      setBgRemoved(false);
      await applyTransforms(sourceToUse, false, activeStyle, bottomFade, tolerance);
    } else {
      // Remove background
      setProcessingBg(true);
      setError("");
      try {
        await applyTransforms(sourceToUse, true, activeStyle, bottomFade, tolerance);
        setBgRemoved(true);
      } catch (err: any) {
        setError("Background removal failed: " + (err.message || String(err)));
      } finally {
        setProcessingBg(false);
      }
    }
  }

  async function handleStyleChange(newStyle: PhotoStylePreset) {
    setActiveStyle(newStyle);
    const sourceToUse = rawOriginal || value;
    if (sourceToUse) {
      await applyTransforms(sourceToUse, bgRemoved, newStyle, bottomFade, tolerance);
    }
  }

  async function handleToleranceChange(newTol: number) {
    setTolerance(newTol);
    const sourceToUse = rawOriginal || value;
    if (sourceToUse && bgRemoved) {
      await applyTransforms(sourceToUse, true, activeStyle, bottomFade, newTol);
    }
  }

  async function handleBottomFadeChange(newFade: number) {
    setBottomFade(newFade);
    const sourceToUse = rawOriginal || value;
    if (sourceToUse) {
      await applyTransforms(sourceToUse, bgRemoved, activeStyle, newFade, tolerance);
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="label">Your {name}</span>

      {value ? (
        <div
          className="panel stack"
          style={{
            padding: 14,
            gap: 12,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
          }}
        >
          {/* Preview Row with Actions */}
          <div className="row" style={{ gap: 14, alignItems: "center" }}>
            <div className="layer-thumb-box" style={{ width: 68, height: 68, minWidth: 68 }}>
              <img
                src={value}
                alt="Selected photo"
                className="layer-thumb-img"
              />
            </div>
            <div className="stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {bgRemoved && (
                  <span className="layer-type-pill image-type" style={{ fontSize: 11 }}>
                    <CheckCircle2 size={12} /> Background removed
                  </span>
                )}
                {activeStyle !== "none" && (
                  <span className="layer-type-pill text-type" style={{ fontSize: 11 }}>
                    <Wand2 size={11} /> {activeStyle === "flyer-match" ? "Flyer Match" : activeStyle}
                  </span>
                )}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`btn ${bgRemoved ? "secondary" : "primary"}`}
                  disabled={processingBg}
                  onClick={handleToggleBgRemoval}
                  style={{ fontSize: 12, padding: "5px 10px" }}
                >
                  {processingBg ? (
                    <>
                      <RotateCw size={13} className="spin" /> Removing…
                    </>
                  ) : bgRemoved ? (
                    <>
                      <Undo2 size={13} /> Restore background
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} /> Remove background
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="btn secondary"
                  style={{ fontSize: 12, padding: "5px 10px" }}
                  onClick={() => {
                    onChange("");
                    setRawOriginal("");
                    setBgRemoved(false);
                    setError("");
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>

          {/* Style & Lighting Presets */}
          <div className="stack" style={{ gap: 6 }}>
            <span className="hint" style={{ fontSize: 11, fontWeight: 600 }}>
              Photo Style & Mood
            </span>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {(
                [
                  ["flyer-match", "Match Flyer"],
                  ["studio", "Studio"],
                  ["dramatic-bw", "B&W"],
                  ["none", "Original"],
                ] as const
              ).map(([presetKey, label]) => (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => handleStyleChange(presetKey)}
                  style={{
                    fontSize: 11,
                    padding: "4px 9px",
                    borderRadius: 6,
                    border: activeStyle === presetKey ? "1.5px solid var(--hot)" : "1px solid var(--border)",
                    background: activeStyle === presetKey ? "var(--hotink)" : "var(--card)",
                    color: activeStyle === presetKey ? "#ffffff" : "var(--foreground)",
                    cursor: "pointer",
                    fontWeight: activeStyle === presetKey ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom Edge Fade / Feathering */}
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={bottomFade > 0}
                onChange={(e) => handleBottomFadeChange(e.target.checked ? 25 : 0)}
              />
              <span className="hint" style={{ fontWeight: 600 }}>
                Blend bottom edge into flyer
              </span>
            </label>
            {bgRemoved && (
              <button
                type="button"
                onClick={() => setShowSensitivity(!showSensitivity)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                {showSensitivity ? "Hide sensitivity" : "Adjust cutout"}
              </button>
            )}
          </div>

          {/* Background Sensitivity Slider */}
          {bgRemoved && showSensitivity && (
            <div className="stack" style={{ gap: 4, padding: "8px 10px", background: "var(--muted)", borderRadius: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 11 }}>
                <span>Cutout sensitivity</span>
                <span>{tolerance}</span>
              </div>
              <input
                type="range"
                min={15}
                max={85}
                value={tolerance}
                onChange={(e) => handleToleranceChange(Number(e.target.value))}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <FileDropzone
            label="Choose a photo or drop it here"
            hint="JPG, PNG or WebP · Up to 10 MB"
            accept="image/jpeg,image/png,image/webp"
            onFile={choose}
          />
          <div className="row">
            <label className="filepick btn secondary">
              <Camera size={15} /> Use camera
              <input
                type="file"
                aria-label="Take a photo"
                accept="image/*"
                capture="user"
                onChange={(e) => {
                  if (e.target.files?.[0]) choose(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="danger" style={{ fontSize: 12 }}>
          {error}
        </p>
      )}
    </div>
  );
}
