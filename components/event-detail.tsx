"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "./shell";
import { StatusBadge, ShareLinkBox, DeleteEvent } from "./event-controls";
import { PlaceholderList } from "./placeholders";
import { FileDropzone } from "./files";
import { DetailsFields } from "./wizard";
import type { Event } from "@/lib/types";
import { MissingFontsPanel } from "./missing-fonts";
import type { ManifestFont } from "@/lib/flyer/types";
import {
  updateEvent,
  deleteEvent,
} from "@/lib/actions/events";
import {
  publishEvent,
  unpublishEvent,
  saveAllPlaceholders,
  getVersionList,
  restoreVersion,
  getRescanSignedUrl,
} from "@/lib/actions/psd";
import {
  createFontUploadUrl,
  finalizeFontUpload,
  deleteFont,
} from "@/lib/actions/fonts";
import { AlertCircle, Trash2, RotateCw, History, Check } from "lucide-react";
import { uploadFileWithFallback } from "@/lib/upload-helper";

export function EventDetail({
  id: _propId,
  initialEvent,
  manifestFonts,
}: {
  id?: string;
  initialEvent?: Event & { formatId?: string; validationIssues?: any[] };
  manifestFonts?: ManifestFont[];
}) {
  const router = useRouter();
  const [e, setEvent] = useState<
    (Event & { formatId?: string; validationIssues?: any[] }) | null
  >(initialEvent || null);

  const [tab, setTab] = useState("Overview");
  const [publishing, setPublishing] = useState(false);
  const [fontUploading, setFontUploading] = useState(false);

  if (!e)
    return (
      <EmptyState
        title="Event not found"
        description="This event may have been deleted or is unavailable."
      />
    );

  const formatId = e.formatId || "";
  const errors = (e.validationIssues || []).filter(
    (i: any) => i.severity === "error"
  );
  const warnings = (e.validationIssues || []).filter(
    (i: any) => i.severity === "warning"
  );

  const handlePublish = async () => {
    setPublishing(true);
    const res = await publishEvent(e.id);
    setPublishing(false);

    if (res.ok) {
      setEvent((prev) => (prev ? { ...prev, status: "Published" } : null));
      toast.success("Event published! Guest link is live.");
      router.refresh();
    } else {
      if (res.issues && Array.isArray(res.issues)) {
        toast.error(`Cannot publish: ${res.issues[0]?.message || res.error}`);
      } else {
        toast.error(res.error);
      }
    }
  };

  const handleUnpublish = async () => {
    const res = await unpublishEvent(e.id);
    if (res.ok) {
      setEvent((prev) => (prev ? { ...prev, status: "Draft" } : null));
      toast.success("Moved to draft. Guest link is now unavailable.");
      router.refresh();
    } else {
      toast.error(res.error);
    }
  };

  const handleFontUpload = async (file: File) => {
    if (!/\.(otf|ttf|woff2)$/i.test(file.name)) {
      toast.error("Choose an OTF, TTF, or WOFF2 font.");
      return;
    }

    setFontUploading(true);
    try {
      const urlRes = await createFontUploadUrl({
        eventId: e.id,
        filename: file.name,
        sizeBytes: file.size,
      });

      if (!urlRes.ok) {
        toast.error(urlRes.error);
        return;
      }

      await uploadFileWithFallback(
        file,
        urlRes.data.uploadUrl,
        urlRes.data.key,
        "public",
        "font/otf"
      );

      const finRes = await finalizeFontUpload({
        eventId: e.id,
        key: urlRes.data.key,
        filename: file.name,
      });

      if (finRes.ok) {
        const familyName = file.name.replace(/\.[^.]+$/, "");
        setEvent((prev) =>
          prev
            ? {
                ...prev,
                fonts: [
                  ...prev.fonts.filter((f) => f.name !== familyName),
                  { name: familyName, status: "Uploaded" },
                ],
              }
            : null
        );
        toast.success(`Font "${familyName}" added successfully.`);
        router.refresh();
      } else {
        toast.error(finRes.error);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Font upload failed";
      toast.error(msg);
    } finally {
      setFontUploading(false);
    }
  };

  return (
    <>
      <StatusBadge status={e.status} />
      <h1>{e.title}</h1>
      <nav className="tabs" aria-label="Event sections">
        {["Overview", "Placeholders", "Versions", "Fonts", "Settings"].map((t) => (
          <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {tab === "Overview" && (
        <div className="dual">
          <div className="panel stack">
            <h2>At a glance</h2>
            <div>
              <strong className="stat">{e.count}</strong>
              <p>Flyers generated</p>
            </div>
            <p>{e.placeholders.length} customizable layers</p>

            {errors.length > 0 && (
              <div className="notice warn stack">
                <div className="row">
                  <AlertCircle size={16} />
                  <strong>{errors.length} validation error(s) block publishing:</strong>
                </div>
                <ul>
                  {errors.map((err: any, idx: number) => (
                    <li key={idx}>
                      {err.layerName ? `[${err.layerName}] ` : ""}
                      {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="notice stack">
                <span className="hint">
                  {warnings.length} warning(s) detected (will not block publishing).
                </span>
              </div>
            )}
          </div>
          <div className="panel stack">
            <h2>Guest access</h2>
            {e.status === "Published" ? (
              <>
                <ShareLinkBox slug={e.slug} />
                <Link href={`/e/${e.slug}`} className="btn primary" target="_blank">
                  Open guest page
                </Link>
                <button className="btn secondary" onClick={handleUnpublish}>
                  Unpublish event
                </button>
              </>
            ) : (
              <>
                <p>
                  Publish this draft to enable guest access. All validation errors must be resolved.
                </p>
                <button
                  className="btn primary"
                  disabled={
                    publishing ||
                    !e.placeholders.length ||
                    errors.length > 0 ||
                    new Set(e.placeholders.map((p) => p.key.trim())).size !==
                      e.placeholders.length ||
                    e.placeholders.some((p) => !p.key.trim())
                  }
                  onClick={handlePublish}
                >
                  {publishing ? "Publishing..." : "Publish draft"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "Placeholders" && (
        <EditLayers
          key={e.id}
          event={e}
          formatId={formatId}
          onRescan={async (_prefix) => {
            if (!formatId) return;
            const res = await getRescanSignedUrl(e.id, formatId);
            if (res.ok) {
              toast.success("Ready to re-scan from PSD backup.");
              router.refresh();
            } else {
              toast.error(res.error);
            }
          }}
          save={async (layers) => {
            const res = await saveAllPlaceholders(e.id, layers);
            if (res.ok) {
              setEvent((prev) => (prev ? { ...prev, placeholders: layers } : null));
              toast.success("Layer changes saved.");
              router.refresh();
            } else {
              toast.error(res.error);
            }
          }}
        />
      )}

      {tab === "Versions" && (
        <VersionsSection eventId={e.id} formatId={formatId} />
      )}

      {tab === "Fonts" && (
        <section className="panel stack">
          <h2>Event fonts</h2>
          <p>
            {e.fonts.length
              ? "Fonts added to this event."
              : "No custom font files yet. The flyer uses system fallbacks."}
          </p>
          {e.fonts.map((f) => (
            <div key={f.name} className="row spread">
              <strong>{f.name}</strong>
              <div className="row">
                <span className="hint">{f.status}</span>
                <button
                  className="iconbtn danger"
                  title="Remove font"
                  onClick={async () => {
                    const res = await deleteFont(e.id, f.name);
                    if (res.ok) {
                      setEvent((prev) =>
                        prev
                          ? {
                              ...prev,
                              fonts: prev.fonts.filter((x) => x.name !== f.name),
                            }
                          : null
                      );
                      toast.success(`Font "${f.name}" removed.`);
                      router.refresh();
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
          <FileDropzone
            label={fontUploading ? "Uploading font..." : "Choose a font file"}
            hint="OTF, TTF or WOFF2"
            accept=".otf,.ttf,.woff2"
            onFile={handleFontUpload}
          />
          {/* Missing fonts from PSD manifest — resolved via Google Fonts or upload */}
          {manifestFonts && manifestFonts.length > 0 && (
            <MissingFontsPanel
              fonts={manifestFonts}
              eventId={e.id}
            />
          )}
        </section>
      )}

      {tab === "Settings" && (
        <div className="stack">
          <section className="panel stack">
            <h2>Event details</h2>
            <EditDetails
              event={e}
              save={async (v) => {
                const res = await updateEvent(e.id, v);
                if (res.ok) {
                  setEvent((prev) => (prev ? { ...prev, ...v } : null));
                  toast.success("Changes saved.");
                  router.refresh();
                } else {
                  toast.error(res.error);
                }
              }}
            />
          </section>
          <section className="panel stack">
            <h2>Danger zone</h2>
            <p>Remove this event from your workspace.</p>
            <div>
              <DeleteEvent
                title={e.title}
                onDelete={async () => {
                  const res = await deleteEvent(e.id);
                  if (res.ok) {
                    toast.success("Event deleted");
                    router.push("/dashboard");
                  } else {
                    toast.error(res.error);
                  }
                }}
              />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function EditLayers({
  event,
  formatId: _fmtId,
  save,
  onRescan,
}: {
  event: Event;
  formatId?: string;
  save: (layers: Event["placeholders"]) => Promise<void>;
  onRescan?: (prefix: string) => Promise<void>;
}) {
  const [layers, setLayers] = useState(event.placeholders);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(layers) !== JSON.stringify(event.placeholders);
  const keys = layers.map((layer) => layer.key.trim());
  const valid =
    keys.length > 0 &&
    keys.every(Boolean) &&
    new Set(keys).size === keys.length;

  return (
    <section className="stack">
      <PlaceholderList
        event={{ ...event, placeholders: layers }}
        onChange={setLayers}
        onRescan={onRescan}
      />
      <p className="hint" role="status">
        {!valid
          ? "Use at least one layer with a unique, nonempty key for each field."
          : dirty
            ? "Unsaved changes. Guests still see the previous layout."
            : "Layer settings are up to date."}
      </p>
      <div className="row">
        <button
          className="btn primary"
          disabled={!dirty || !valid || saving}
          onClick={async () => {
            setSaving(true);
            await save(layers);
            setSaving(false);
          }}
        >
          {saving ? "Saving..." : "Save layer changes"}
        </button>
        <button
          className="btn secondary"
          disabled={!dirty || saving}
          onClick={() => setLayers(event.placeholders)}
        >
          Discard changes
        </button>
      </div>
    </section>
  );
}

function EditDetails({
  event,
  save,
}: {
  event: Event;
  save: (v: Partial<Event>) => Promise<void>;
}) {
  const [draft, setDraft] = useState(event);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="fields"
      onSubmit={async (ev) => {
        ev.preventDefault();
        if (!draft.title.trim() || !draft.description.trim()) {
          toast.error("Enter a title and description.");
          return;
        }
        setSaving(true);
        await save({
          title: draft.title,
          date: draft.date,
          description: draft.description,
        });
        setSaving(false);
      }}
    >
      <DetailsFields
        event={draft}
        change={(v) => setDraft((p) => ({ ...p, ...v }))}
      />
      <button className="btn secondary" disabled={saving}>
        {saving ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}

function VersionsSection({ eventId, formatId }: { eventId: string; formatId: string }) {
  const router = useRouter();
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const fetchVersions = () => {
    if (!formatId) return;
    setLoading(true);
    getVersionList(eventId, formatId)
      .then((res) => {
        if (res.ok) {
          setVersions(res.data.versions);
        }
      })
      .finally(() => setLoading(false));
  };

  useState(() => {
    fetchVersions();
  });

  const handleRestore = async (versionId: string) => {
    setRestoringId(versionId);
    const res = await restoreVersion({ eventId, formatId, versionId });
    setRestoringId(null);
    if (res.ok) {
      toast.success("Version restored successfully!");
      fetchVersions();
      router.refresh();
    } else {
      toast.error(res.error);
    }
  };

  return (
    <section className="panel stack" style={{ gap: "16px" }}>
      <div className="row spread" style={{ alignItems: "center" }}>
        <div>
          <h2>Version history</h2>
          <span className="hint">
            Review processed flyer versions, download weights, fidelity scores, and restore earlier versions.
          </span>
        </div>
        <button
          type="button"
          className="btn ghost small"
          disabled={loading}
          onClick={fetchVersions}
        >
          <RotateCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="hint">Loading version history...</p>
      ) : versions.length === 0 ? (
        <p className="hint">No versions found for this event format.</p>
      ) : (
        <div className="stack" style={{ gap: "12px" }}>
          {versions.map((ver) => {
            const prevMb = ((ver.totalPreviewBytes ?? 0) / (1024 * 1024)).toFixed(2);
            const fullMb = ((ver.totalFullBytes ?? 0) / (1024 * 1024)).toFixed(1);
            const fidelityPct = ver.fidelityScore ? `${Math.round(Number(ver.fidelityScore) * 100)}%` : "N/A";

            return (
              <div
                key={ver.id}
                className="panel"
                style={{
                  border: ver.isPublished ? "1.5px solid var(--primary)" : "1px solid var(--border)",
                  background: ver.isPublished ? "rgba(var(--primary-rgb, 99, 102, 241), 0.04)" : "var(--card)",
                  padding: "16px",
                }}
              >
                <div className="row spread" style={{ alignItems: "flex-start", gap: "12px" }}>
                  <div className="stack" style={{ gap: "4px" }}>
                    <div className="row" style={{ gap: "8px", alignItems: "center" }}>
                      <strong style={{ fontSize: "1.05rem" }}>Version {ver.version}</strong>
                      <span className={`badge ${ver.status === "ready" ? "success" : ver.status === "failed" ? "danger" : "warning"}`}>
                        {ver.status}
                      </span>
                      {ver.isPublished && (
                        <span className="badge primary row" style={{ gap: "4px" }}>
                          <Check size={12} /> Active Published
                        </span>
                      )}
                    </div>
                    <span className="hint">
                      Created {new Date(ver.createdAt).toLocaleString()} · PSD Backup: {ver.psdUploadStatus}
                    </span>
                    <div className="row wrap" style={{ gap: "12px", marginTop: "4px", fontSize: "0.85rem" }}>
                      <span>
                        <strong>Slices:</strong> {ver.sliceCount}
                      </span>
                      <span>
                        <strong>Mobile Preview:</strong> {prevMb} MB
                      </span>
                      <span>
                        <strong>Full Export:</strong> {fullMb} MB
                      </span>
                      <span>
                        <strong>Fidelity:</strong> {fidelityPct}
                      </span>
                    </div>
                  </div>

                  {!ver.isPublished && ver.status === "ready" && (
                    <button
                      type="button"
                      className="btn secondary small"
                      disabled={restoringId === ver.id}
                      onClick={() => handleRestore(ver.id)}
                    >
                      <History size={13} />
                      {restoringId === ver.id ? "Restoring..." : "Restore version"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

