"use client";

import { useState } from "react";
import { HardDrive, ChevronDown, ChevronUp, AlertCircle, CheckCircle } from "lucide-react";

export function DownloadWeightCard({
  totalPreviewBytes,
  totalFullBytes,
  sliceCount,
  slices = [],
  budgetBytes = 2.5 * 1024 * 1024,
}: {
  totalPreviewBytes?: number;
  totalFullBytes?: number;
  sliceCount?: number;
  slices?: Array<{ id: string; previewBytes?: number; fullBytes?: number; w?: number; h?: number }>;
  budgetBytes?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const prevMb = ((totalPreviewBytes ?? 0) / (1024 * 1024)).toFixed(2);
  const fullMb = ((totalFullBytes ?? 0) / (1024 * 1024)).toFixed(1);
  const budgetMb = (budgetBytes / (1024 * 1024)).toFixed(1);
  const isOverBudget = (totalPreviewBytes ?? 0) > budgetBytes;
  const pctOfBudget = Math.min(100, Math.round(((totalPreviewBytes ?? 0) / budgetBytes) * 100));

  return (
    <div
      className="panel stack"
      style={{
        border: isOverBudget ? "1.5px solid #ef4444" : "1px solid var(--border)",
        background: "var(--card)",
      }}
    >
      <div className="row spread" style={{ alignItems: "center" }}>
        <div className="row" style={{ gap: "10px", alignItems: "center" }}>
          <HardDrive size={18} className={isOverBudget ? "text-red-500" : "text-primary"} />
          <div>
            <strong>Download Weight</strong>
            <span className="hint" style={{ display: "block" }}>
              Mobile preview: {prevMb} MB / {budgetMb} MB budget · Full export: {fullMb} MB
            </span>
          </div>
        </div>

        <div className="row" style={{ gap: "8px", alignItems: "center" }}>
          {isOverBudget ? (
            <span className="badge danger">Over Budget</span>
          ) : (
            <span className="badge success">Fast Loading</span>
          )}
          {slices.length > 0 && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {sliceCount ?? slices.length} slices
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: "4px" }}>
        <div
          style={{
            height: "6px",
            width: "100%",
            background: "var(--muted)",
            borderRadius: "3px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pctOfBudget}%`,
              background: isOverBudget ? "#ef4444" : "#10b981",
              borderRadius: "3px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      {isOverBudget && (
        <p className="hint text-red-500" style={{ margin: 0 }}>
          Preview download exceeds the 2.5 MB budget. Guests on mobile networks may experience slower initial load times.
        </p>
      )}

      {expanded && slices.length > 0 && (
        <div
          style={{
            marginTop: "8px",
            borderTop: "1px solid var(--border)",
            paddingTop: "8px",
          }}
        >
          <span className="hint" style={{ fontWeight: 600, display: "block", marginBottom: "6px" }}>
            Per-slice weight breakdown
          </span>
          <div className="stack" style={{ gap: "4px", maxHeight: "160px", overflowY: "auto" }}>
            {slices.map((s, idx) => {
              const pKb = s.previewBytes ? (s.previewBytes / 1024).toFixed(0) : "0";
              const fKb = s.fullBytes ? (s.fullBytes / 1024).toFixed(0) : "0";
              return (
                <div
                  key={s.id || idx}
                  className="row spread"
                  style={{
                    fontSize: "0.82rem",
                    padding: "3px 6px",
                    background: "var(--muted)",
                    borderRadius: "4px",
                  }}
                >
                  <span>
                    Slice {idx + 1} {s.w && s.h ? `(${s.w}×${s.h}px)` : ""}
                  </span>
                  <span className="hint">
                    Preview: {pKb} KB · Full: {fKb} KB
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
