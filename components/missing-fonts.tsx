"use client";

import { useState, useRef } from "react";
import { Upload, ExternalLink, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  createFontUploadUrl,
  finalizeFontUpload,
  resolveGoogleFont,
  saveResolvedFont,
} from "@/lib/actions/fonts";
import type { ManifestFont } from "@/lib/flyer/types";
import { buildGoogleFontsCssUrl, normalizePostScriptFontName } from "@/lib/flyer/fonts";
import { uploadFileWithFallback } from "@/lib/upload-helper";

export interface MissingFontsProps {
  /** Missing fonts from the manifest (where missing === true) */
  fonts: ManifestFont[];
  /** The event this font belongs to — needed for the upload action */
  eventId: string;
  /**
   * Called after any font is resolved (uploaded or linked).
   * The parent should update its local font state so the preview re-renders.
   */
  onResolved?: (updated: ManifestFont) => void;
}

type FontState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "found"; url: string }
  | { status: "not-found" }
  | { status: "uploading" }
  | { status: "done" };

/** Per-font state machine */
function useFontResolver(font: ManifestFont, eventId: string, onResolved?: (f: ManifestFont) => void) {
  const [state, setState] = useState<FontState>({ status: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function checkGoogleFonts() {
    setState({ status: "checking" });
    try {
      const norm = normalizePostScriptFontName(font.family);
      const lookupFamily = norm.family;
      const lookupWeight = font.weight ?? norm.weight;
      const lookupStyle = font.style ?? norm.style;

      // 1. Try server action first (avoids browser CORS & forbidden User-Agent header restrictions)
      const serverRes = await resolveGoogleFont({
        family: lookupFamily,
        weight: lookupWeight,
        style: lookupStyle,
      }).catch(() => null);

      if (serverRes?.ok && serverRes.data.url) {
        setState({ status: "found", url: serverRes.data.url });
        return;
      }

      // 2. Fallback to client fetch without custom headers (modern browsers send desktop User-Agent automatically)
      try {
        const cssUrl = buildGoogleFontsCssUrl([
          { family: lookupFamily, weight: lookupWeight, style: lookupStyle },
        ]);
        const res = await fetch(cssUrl);
        if (res.ok) {
          const css = await res.text();
          const match = css.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+\.woff2)\)/);
          if (match) {
            setState({ status: "found", url: match[1] });
            return;
          }
        }
      } catch {
        // client fetch failed
      }

      setState({ status: "not-found" });
    } catch {
      setState({ status: "not-found" });
    }
  }

  async function linkGoogleFont(url: string) {
    setState({ status: "uploading" });
    try {
      const norm = normalizePostScriptFontName(font.family);
      const weight = font.weight ?? norm.weight;
      const style = font.style ?? norm.style;

      // 1. Permanently save to event fonts table and R2 manifest.json
      const saveRes = await saveResolvedFont({
        eventId,
        family: norm.family,
        weight,
        style,
        url,
      });

      if (!saveRes.ok) {
        throw new Error(saveRes.error);
      }

      // 2. Immediately load into browser document.fonts so canvas & preview re-render with the font
      if (typeof document !== "undefined" && "fonts" in document) {
        try {
          const face = new FontFace(norm.family, `url(${url})`, {
            weight: String(weight ?? 400),
            style: style ?? "normal",
          });
          await face.load();
          document.fonts.add(face);
        } catch (fontErr) {
          console.warn("Could not register FontFace in document.fonts:", fontErr);
        }
      }

      const updatedFont: ManifestFont = {
        ...font,
        family: norm.family,
        weight,
        style,
        url,
        missing: false,
      };

      onResolved?.(updatedFont);
      setState({ status: "done" });
      toast.success(`"${norm.family}" applied and saved.`);
    } catch (err) {
      setState({ status: "not-found" });
      toast.error(err instanceof Error ? err.message : "Failed to link Google Font.");
    }
  }

  async function uploadFile(file: File) {
    const allowed = [".ttf", ".otf", ".woff", ".woff2"];
    if (!allowed.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      toast.error("Choose a TTF, OTF, WOFF, or WOFF2 font file.");
      return;
    }
    setState({ status: "uploading" });
    try {
      const urlRes = await createFontUploadUrl({
        eventId,
        filename: file.name,
        sizeBytes: file.size,
      });
      if (!urlRes.ok) throw new Error(urlRes.error);

      // Upload with fallback to server-side upload proxy if direct R2 upload fails
      await uploadFileWithFallback(
        file,
        urlRes.data.uploadUrl,
        urlRes.data.key,
        "public",
        "font/otf"
      );

      const norm = normalizePostScriptFontName(font.family);
      const finRes = await finalizeFontUpload({
        eventId,
        key: urlRes.data.key,
        filename: file.name,
        family: norm.family,
        weight: font.weight ?? norm.weight,
        style: font.style ?? norm.style,
      });
      if (!finRes.ok) throw new Error(finRes.error);

      const publicUrl = `/api/public/assets/${urlRes.data.key}`;

      // Immediately load into browser document.fonts
      if (typeof document !== "undefined" && "fonts" in document) {
        try {
          const face = new FontFace(norm.family, `url(${publicUrl})`, {
            weight: String(font.weight ?? norm.weight ?? 400),
            style: font.style ?? norm.style ?? "normal",
          });
          await face.load();
          document.fonts.add(face);
        } catch (fontErr) {
          console.warn("Could not register FontFace in document.fonts:", fontErr);
        }
      }

      const updatedFont: ManifestFont = {
        ...font,
        family: norm.family,
        weight: font.weight ?? norm.weight,
        style: font.style ?? norm.style,
        url: publicUrl,
        missing: false,
      };

      onResolved?.(updatedFont);
      setState({ status: "done" });
      toast.success(`"${norm.family}" uploaded and applied.`);
    } catch (err) {
      setState({ status: "not-found" });
      toast.error(err instanceof Error ? err.message : "Font upload failed.");
    }
  }

  return { state, checkGoogleFonts, linkGoogleFont, uploadFile, inputRef };
}

function FontRow({
  font,
  eventId,
  onResolved,
}: {
  font: ManifestFont;
  eventId: string;
  onResolved?: (f: ManifestFont) => void;
}) {
  const { state, checkGoogleFonts, linkGoogleFont, uploadFile, inputRef } =
    useFontResolver(font, eventId, onResolved);

  const busy = state.status === "checking" || state.status === "uploading";

  if (state.status === "done") {
    return (
      <div className="row" style={{ gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
        <CheckCircle2 size={16} className="text-emerald-500" style={{ flexShrink: 0 }} />
        <span style={{ fontWeight: 500 }}>{font.family}</span>
        <span className="hint" style={{ marginLeft: "auto" }}>Resolved ✓</span>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "12px 0",
        borderBottom: "1px solid var(--border)",
        display: "grid",
        gap: 8,
      }}
    >
      {/* Font name + weight */}
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <AlertTriangle size={15} style={{ color: "#f59e0b", flexShrink: 0 }} />
        <span style={{ fontWeight: 600 }}>{font.family}</span>
        {font.weight && font.weight !== 400 && (
          <span className="badge" style={{ fontSize: "0.75rem" }}>w{font.weight}</span>
        )}
        {font.style && font.style !== "normal" && (
          <span className="badge" style={{ fontSize: "0.75rem" }}>{font.style}</span>
        )}
        <span className="hint" style={{ marginLeft: "auto", fontSize: "0.78rem" }}>Missing</span>
      </div>

      {/* Action row */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {state.status === "idle" && (
          <button
            type="button"
            className="btn secondary small"
            onClick={checkGoogleFonts}
          >
            <ExternalLink size={13} />
            Check Google Fonts
          </button>
        )}

        {state.status === "checking" && (
          <span className="row hint" style={{ gap: 6 }}>
            <Loader2 size={14} className="animate-spin" /> Checking Google Fonts…
          </span>
        )}

        {state.status === "found" && (
          <>
            <span className="hint" style={{ color: "#16a34a", fontSize: "0.82rem" }}>
              Found on Google Fonts!
            </span>
            <button
              type="button"
              className="btn primary small"
              onClick={() => linkGoogleFont((state as { status: "found"; url: string }).url)}
            >
              <ExternalLink size={13} />
              Use Google Fonts version
            </button>
          </>
        )}

        {state.status === "not-found" && (
          <span className="hint" style={{ color: "var(--danger)", fontSize: "0.82rem" }}>
            Not on Google Fonts. Upload the font file below.
          </span>
        )}

        {state.status === "uploading" && (
          <span className="row hint" style={{ gap: 6 }}>
            <Loader2 size={14} className="animate-spin" /> Uploading…
          </span>
        )}

        {/* Upload button — always visible unless done */}
        <label
          className="btn secondary small"
          style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
        >
          <Upload size={13} />
          {state.status === "uploading" ? "Uploading…" : "Upload font file"}
          <input
            ref={inputRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* Google Fonts link for reference */}
      {(state.status === "idle" || state.status === "not-found" || state.status === "found") && (
        <a
          href={`https://fonts.google.com/specimen/${font.family.replace(/ /g, "+")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hint"
          style={{ fontSize: "0.78rem", textDecoration: "underline" }}
        >
          Browse "{font.family}" on Google Fonts ↗
        </a>
      )}
    </div>
  );
}

/**
 * Panel that surfaces missing fonts from a FlyerManifest and lets the
 * designer either link them from Google Fonts or upload a custom file.
 *
 * Usage: render this after the ValidationReport in the wizard Placeholders
 * step, and in the event-detail Fonts tab.
 */
export function MissingFontsPanel({ fonts, eventId, onResolved }: MissingFontsProps) {
  const missing = fonts.filter((f) => f.missing);
  if (missing.length === 0) return null;

  return (
    <section
      className="panel stack"
      style={{
        border: "1px solid #f59e0b55",
        background: "#fffbeb",
        borderRadius: 8,
        padding: "16px",
        gap: 4,
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 4 }}>
        <AlertTriangle size={16} style={{ color: "#f59e0b" }} />
        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
          {missing.length === 1
            ? "1 font is missing"
            : `${missing.length} fonts are missing`}
        </h3>
      </div>
      <p className="hint" style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
        These fonts were detected in your PSD but are not available in guests'
        browsers. Link them from Google Fonts (free, instant) or upload your
        licensed font files.
      </p>

      {missing.map((f) => (
        <FontRow
          key={`${f.family}-${f.weight ?? 400}-${f.style ?? "normal"}`}
          font={f}
          eventId={eventId}
          onResolved={onResolved}
        />
      ))}
    </section>
  );
}
