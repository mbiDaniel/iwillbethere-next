"use client";

import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";

export interface ValidationItem {
  code: string;
  severity: "error" | "warning" | "passed";
  message: string;
  layerName?: string | null;
  placeholderId?: string | null;
}

export function ValidationReport({
  issues = [],
}: {
  issues?: ValidationItem[];
}) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const passed = issues.filter((i) => i.severity === "passed");

  if (issues.length === 0) {
    return (
      <div className="panel row" style={{ gap: "10px", alignItems: "center" }}>
        <CheckCircle2 size={18} className="text-emerald-500" />
        <div>
          <strong>Validation passed</strong>
          <span className="hint" style={{ display: "block" }}>
            All checks passed with zero errors or warnings.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel stack" style={{ gap: "10px" }}>
      <div className="row spread" style={{ alignItems: "center" }}>
        <strong>Flyer Validation Report</strong>
        <div className="row" style={{ gap: "6px" }}>
          {errors.length > 0 && (
            <span className="badge danger">{errors.length} error{errors.length > 1 ? "s" : ""}</span>
          )}
          {warnings.length > 0 && (
            <span className="badge warning">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</span>
          )}
          {errors.length === 0 && warnings.length === 0 && (
            <span className="badge success">Passed</span>
          )}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="stack" style={{ gap: "6px" }}>
          <span className="hint" style={{ color: "var(--danger)", fontWeight: 600 }}>
            Blocking errors (must resolve before publishing):
          </span>
          {errors.map((err, i) => (
            <div
              key={i}
              className="row"
              style={{
                gap: "8px",
                background: "rgba(239, 68, 68, 0.08)",
                padding: "8px 12px",
                borderRadius: "6px",
                alignItems: "flex-start",
              }}
            >
              <AlertCircle size={16} className="text-red-500" style={{ marginTop: "2px", flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: "0.88rem", fontWeight: 500 }}>{err.message}</span>
                {err.layerName && (
                  <span className="hint" style={{ display: "block" }}>
                    Layer: {err.layerName} · Code: {err.code}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="stack" style={{ gap: "6px" }}>
          <span className="hint" style={{ color: "#f59e0b", fontWeight: 600 }}>
            Warnings & Suggestions:
          </span>
          {warnings.map((warn, i) => (
            <div
              key={i}
              className="row"
              style={{
                gap: "8px",
                background: "rgba(245, 158, 11, 0.08)",
                padding: "8px 12px",
                borderRadius: "6px",
                alignItems: "flex-start",
              }}
            >
              <AlertTriangle size={16} className="text-amber-500" style={{ marginTop: "2px", flexShrink: 0 }} />
              <div>
                <span style={{ fontSize: "0.88rem", fontWeight: 500 }}>{warn.message}</span>
                {warn.layerName && (
                  <span className="hint" style={{ display: "block" }}>
                    Layer: {warn.layerName} · Code: {warn.code}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
