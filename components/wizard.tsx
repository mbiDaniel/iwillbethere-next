"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, RotateCw, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { dateLabel } from "@/lib/mock-data";
import { FileDropzone } from "./files";
import { ManualPlaceholderPicker } from "./manual-placeholder-picker";
import { PlaceholderList } from "./placeholders";
import { ShareLinkBox } from "./event-controls";
import { FlyerPreview } from "./flyer";
import type { Event, Placeholder } from "@/lib/types";
import { createEvent } from "@/lib/actions/events";
import {
  createVersion,
  createAssetUploadUrls,
  createPsdBackupUploadUrl,
  finalizePsdBackupUpload,
  commitVersion,
  publishEvent,
  saveAllPlaceholders,
  getRescanSignedUrl,
} from "@/lib/actions/psd";
import { generateQrCodeSvg } from "@/lib/qr";
import { inspectPsdLayersInWorker, runPsdSlicer } from "@/lib/flyer/worker-client";
import type { ManualPlaceholderMapping, PsdLayerDescriptor } from "@/lib/flyer/detect";
import { createFlattenedFallback, SlicerResult } from "@/lib/flyer/slice";
import { uploadAssetsConcurrently } from "@/lib/flyer/uploader";
import { FlyerManifest, SlicedAsset, ManifestPlaceholder, ManifestItem } from "@/lib/flyer/types";

const steps = ["Details", "Upload PSD", "Placeholders", "Review"];

export function Stepper({ step }: { step: number }) {
  return (
    <div className="stepper" aria-label="Event creation steps">
      {steps.map((s, i) => (
        <span
          key={s}
          aria-current={step === i ? "step" : undefined}
          className={step === i ? "active" : ""}
        >
          {i + 1}. {s}
        </span>
      ))}
    </div>
  );
}

export function DetailsFields({
  event,
  change,
}: {
  event: Event;
  change: (v: Partial<Event>) => void;
}) {
  return (
    <div className="fields">
      <label>
        Event title
        <input
          required
          maxLength={90}
          value={event.title}
          placeholder="Give your event a name"
          onChange={(e) => change({ title: e.target.value })}
        />
      </label>
      <label>
        Date and time
        <input
          required
          type="datetime-local"
          value={event.date}
          onChange={(e) => change({ date: e.target.value })}
        />
      </label>
      <label>
        Description
        <textarea
          required
          maxLength={500}
          value={event.description}
          placeholder="What should your guests know?"
          onChange={(e) => change({ description: e.target.value })}
        />
      </label>
    </div>
  );
}

export function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [event, setEvent] = useState<Event>({
    id: "",
    slug: "",
    title: "",
    description: "",
    date: "",
    artwork: "/open-studio.svg",
    count: 0,
    status: "Draft",
    placeholders: [],
    fonts: [],
  });

  const [formatId, setFormatId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [manifest, setManifest] = useState<FlyerManifest | null>(null);
  const [compositeUrl, setCompositeUrl] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<any[]>([]);

  // Staged progress state
  const [processingStage, setProcessingStage] = useState<
    "idle" | "reading" | "detecting" | "slicing" | "uploading" | "verifying" | "ready" | "failed"
  >("idle");
  const [stageProgressPercent, setStageProgressPercent] = useState(0);
  const [uploadStats, setUploadStats] = useState<{ completed: number; total: number; uploadedBytes: number; totalBytes: number }>({
    completed: 0,
    total: 0,
    uploadedBytes: 0,
    totalBytes: 0,
  });
  const [backupPsdStatus, setBackupPsdStatus] = useState<"pending" | "uploading" | "uploaded" | "failed">("pending");

  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const originalFileRef = useRef<File | null>(null);
  const manualPlaceholdersRef = useRef<ManualPlaceholderMapping[]>([]);
  const [pendingPsd, setPendingPsd] = useState<{
    file: File;
    layers: PsdLayerDescriptor[];
  } | null>(null);
  const [inspectingPsd, setInspectingPsd] = useState(false);

  const change = (v: Partial<Event>) => setEvent((prev) => ({ ...prev, ...v }));

  const cancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setProcessingStage("idle");
    setError("Upload cancelled by user.");
  };

  const processPsdFile = async (
    f: File,
    manualPlaceholders: ManualPlaceholderMapping[] = []
  ) => {
    if (!f.name.toLowerCase().endsWith(".psd")) {
      setError("Please choose a Photoshop .psd file.");
      return;
    }
    if (!event.id || !formatId) {
      setError("The event format is not ready yet. Go back and try again.");
      return;
    }

    setPendingPsd(null);
    manualPlaceholdersRef.current = manualPlaceholders;
    originalFileRef.current = f;
    setError("");
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    try {
      // Step 1: Create version row in database
      setProcessingStage("reading");
      setStageProgressPercent(10);

      const verRes = await createVersion({
        eventId: event.id,
        formatId,
      });

      if (!verRes.ok) {
        throw new Error(verRes.error);
      }
      const newVersionId = verRes.data.versionId;
      setVersionId(newVersionId);

      // Read file into ArrayBuffer
      const arrayBuffer = await f.arrayBuffer();

      // Start background PSD backup upload into private bucket (non-blocking)
      uploadPsdBackupInBackground(newVersionId, f, arrayBuffer);

      // Step 2 & 3: Run client-side PSD slicing in Web Worker
      setProcessingStage("slicing");
      const sliceResult: SlicerResult = await runPsdSlicer(arrayBuffer, {
        prefix: "#PLACEHOLDER_",
        manualPlaceholders,
        onProgress: (st, pct) => {
          if (st === "detecting") setProcessingStage("detecting");
          else if (st === "slicing" || st === "encoding") setProcessingStage("slicing");
          setStageProgressPercent(pct);
        },
      });

      if (sliceResult.compositeBlob) {
        setCompositeUrl(URL.createObjectURL(sliceResult.compositeBlob));
      }

      // Step 4: Request presigned upload URLs for slices and masks
      setProcessingStage("uploading");
      setStageProgressPercent(65);

      const assetPayload = sliceResult.assets.map((a: SlicedAsset) => ({
        kind: a.kind,
        tier: a.tier,
        sha256: a.sha256,
        bytes: a.bytes,
        contentType: a.contentType,
      }));

      const urlRes = await createAssetUploadUrls({
        versionId: newVersionId,
        assets: assetPayload,
      });

      if (!urlRes.ok) {
        throw new Error(urlRes.error);
      }

      const tasks = urlRes.data.uploadUrls.map((u) => {
        const matchingAsset = sliceResult.assets.find(
          (a: SlicedAsset) => a.sha256 === u.sha256 && a.tier === u.tier && a.kind === u.kind
        );
        if (!matchingAsset) {
          throw new Error(`Asset not found for hash ${u.sha256}`);
        }
        return {
          ...u,
          blob: matchingAsset.blob,
          contentType: matchingAsset.contentType,
        };
      });

      // Upload all slices concurrently (limit 4) with progress
      await uploadAssetsConcurrently(tasks, {
        concurrency: 4,
        signal: abortCtrl.signal,
        onProgress: (info) => {
          setUploadStats({
            completed: info.completedCount,
            total: info.totalCount,
            uploadedBytes: info.uploadedBytes,
            totalBytes: info.totalBytes,
          });
          setStageProgressPercent(65 + Math.round(info.percent * 0.25));
        },
      });

      // Step 5: Commit version with manifest
      setProcessingStage("verifying");
      setStageProgressPercent(95);

      const commitRes = await commitVersion({
        versionId: newVersionId,
        manifest: sliceResult.manifest,
      });

      if (!commitRes.ok) {
        throw new Error(commitRes.error);
      }

      setManifest(sliceResult.manifest);
      setValidationIssues(commitRes.data.issues || sliceResult.validationIssues || []);

      // Map placeholders to event state
      const mappedPlaceholders: Placeholder[] = sliceResult.manifest.placeholders.map((p: ManifestPlaceholder) => ({
        id: p.id,
        layerName: p.layerName,
        key: p.key,
        type: p.type,
        sampleValue: p.options.sampleValue,
        box: {
          x: Number(((p.box.x / sliceResult.manifest.width) * 100).toFixed(2)),
          y: Number(((p.box.y / sliceResult.manifest.height) * 100).toFixed(2)),
          w: Number(((p.box.w / sliceResult.manifest.width) * 100).toFixed(2)),
          h: Number(((p.box.h / sliceResult.manifest.height) * 100).toFixed(2)),
        },
        options: p.options as any,
      }));

      const firstSlice = sliceResult.manifest.items.find((i: ManifestItem) => i.kind === "slice");
      const previewUrl = firstSlice?.kind === "slice" ? firstSlice.assets.preview.url : null;

      change({
        artwork: previewUrl || event.artwork,
        placeholders: mappedPlaceholders,
        manifestUrl: commitRes.data.manifestUrl,
      });

      setProcessingStage("ready");
      setStageProgressPercent(100);
      toast.success("PSD successfully sliced and verified!");
    } catch (err: unknown) {
      if (abortCtrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Failed to process and slice PSD";
      setError(msg);
      setProcessingStage("failed");
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handlePsdSelected = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".psd")) {
      setError("Please choose a Photoshop .psd file.");
      return;
    }

    setInspectingPsd(true);
    setPendingPsd(null);
    setError("");
    try {
      const buffer = await file.arrayBuffer();
      const layers = await inspectPsdLayersInWorker(buffer);
      if (layers.some((layer) => layer.hasPlaceholderTag)) {
        setInspectingPsd(false);
        await processPsdFile(file);
      } else {
        originalFileRef.current = file;
        setPendingPsd({ file, layers });
        setProcessingStage("idle");
      }
    } catch (inspectionError: unknown) {
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : "Could not inspect PSD layers. Please try another file."
      );
      setProcessingStage("failed");
    } finally {
      setInspectingPsd(false);
    }
  };

  const uploadPsdBackupInBackground = async (
    verId: string,
    file: File,
    buffer: ArrayBuffer
  ) => {
    try {
      setBackupPsdStatus("uploading");
      const backupUrlRes = await createPsdBackupUploadUrl({
        versionId: verId,
        filename: file.name,
        sizeBytes: file.size,
      });

      if (!backupUrlRes.ok) {
        console.warn("PSD backup URL failed:", backupUrlRes.error);
        setBackupPsdStatus("failed");
        return;
      }

      const putRes = await fetch(backupUrlRes.data.uploadUrl, {
        method: "PUT",
        body: buffer,
        headers: { "Content-Type": "image/vnd.adobe.photoshop" },
      });

      if (!putRes.ok) {
        console.warn("PSD backup PUT failed:", putRes.statusText);
        setBackupPsdStatus("failed");
        return;
      }

      await finalizePsdBackupUpload({
        versionId: verId,
        key: backupUrlRes.data.key,
      });

      setBackupPsdStatus("uploaded");
    } catch (backupErr) {
      console.warn("Background PSD backup error:", backupErr);
      setBackupPsdStatus("failed");
    }
  };

  const handleUseSamplePsd = async () => {
    setError("");
    setProcessingStage("reading");
    try {
      const sampleRes = await fetch("/api/sample-psd");
      const blob = await sampleRes.blob();
      const sampleFile = new File([blob], "after-hours.psd", {
        type: "image/vnd.adobe.photoshop",
      });
      await processPsdFile(sampleFile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load sample PSD";
      setError(msg);
      setProcessingStage("failed");
    }
  };

  const handleRescan = async (newPrefix: string) => {
    setError("");
    try {
      // Request download URL for stored PSD from private bucket
      const res = await getRescanSignedUrl(event.id, formatId);
      if (!res.ok) {
        toast.error(res.error || "Please select your PSD file directly to re-scan.");
        return;
      }

      toast.info("Downloading stored PSD for re-scan...");
      const psdRes = await fetch(res.data.downloadUrl);
      if (!psdRes.ok) {
        throw new Error("Could not download stored PSD backup.");
      }
      const blob = await psdRes.blob();
      const psdFile = new File([blob], "backup.psd", { type: "image/vnd.adobe.photoshop" });
      await processPsdFile(psdFile);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Re-scan failed");
    }
  };

  const handleUseFlattenedFallback = async () => {
    if (!originalFileRef.current || !manifest) return;
    try {
      toast.info("Building flattened fallback slice...");
      const buf = await originalFileRef.current.arrayBuffer();
      const fallback = await createFlattenedFallback(buf, manifest.placeholders);

      const commitRes = await commitVersion({
        versionId,
        manifest: fallback.manifest,
      });

      if (commitRes.ok) {
        setManifest(fallback.manifest);
        toast.success("Applied flattened fallback composite!");
      } else {
        toast.error(commitRes.error);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Fallback export failed");
    }
  };

  async function next() {
    setError("");

    // Step 0 -> Create event on backend
    if (step === 0) {
      if (!event.title.trim() || !event.date || !event.description.trim()) {
        setError("Enter the title, date and time, and a description.");
        return;
      }

      const res = await createEvent({
        title: event.title,
        description: event.description,
        date: event.date,
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      change({ id: res.data.id, slug: res.data.slug });
      setFormatId(res.data.formatId);

      setStep(1);
      return;
    }

    // Step 1 -> Require PSD to be sliced and ready
    if (step === 1) {
      if (!versionId || processingStage !== "ready") {
        setError("Please choose a PSD file and wait for slicing to complete.");
        return;
      }
      setStep(2);
      return;
    }

    // Step 2 -> Validate placeholders
    if (step === 2) {
      if (
        !event.placeholders.length ||
        event.placeholders.some((p) => !p.key.trim()) ||
        new Set(event.placeholders.map((p) => p.key.trim())).size !==
          event.placeholders.length
      ) {
        setError("Add at least one placeholder and give each a unique, nonempty key.");
        return;
      }

      const saveRes = await saveAllPlaceholders(event.id, event.placeholders);
      if (!saveRes.ok) {
        setError(saveRes.error);
        return;
      }
      setStep(3);
      return;
    }

    // Step 3 -> Publish
    if (step === 3) {
      setPublishing(true);
      const res = await publishEvent(event.id);
      setPublishing(false);

      if (res.ok) {
        change({ status: "Published" });
        setDone(true);
        toast.success("Event published successfully!");
      } else {
        setError(res.error);
      }
    }
  }

  if (done) {
    return (
      <section className="panel centered">
        <CheckCircle2 size={40} className="text-primary" />
        <h1>Your event is ready.</h1>
        <p>{event.title} is published and ready for guests.</p>
        <div className="actions">
          <Link className="btn primary" href={`/e/${event.slug}`} target="_blank">
            Open guest page
          </Link>
          <Link className="btn secondary" href="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </section>
    );
  }

  const guestUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/e/${event.slug}`
      : `/e/${event.slug}`;

  const qrSvg = generateQrCodeSvg(guestUrl, 120);

  return (
    <>
      <h1>Create an event.</h1>
      <Stepper step={step} />
      <div className="panel stack">
        <h2>{steps[step]}</h2>

        {step === 0 && <DetailsFields event={event} change={change} />}

        {step === 1 && (
          <>
            <p>
              Choose your Photoshop flyer (.psd). Your browser will slice artwork layers locally in a Web Worker and upload compact PNG slices.
            </p>
            <FileDropzone
              label="Choose or drop your PSD"
              accept=".psd"
              hint="Photoshop document (.psd) up to 100 MB"
              onFile={handlePsdSelected}
            />
            {inspectingPsd && (
              <p role="status" className="hint">
                Checking PSD layers…
              </p>
            )}
            {pendingPsd && (
              <ManualPlaceholderPicker
                layers={pendingPsd.layers}
                busy={processingStage !== "idle" && processingStage !== "failed"}
                onStart={(mappings) => processPsdFile(pendingPsd.file, mappings)}
              />
            )}

            <div className="row spread" style={{ alignItems: "center", gap: "8px" }}>
              <button
                type="button"
                className="btn secondary"
                disabled={processingStage !== "idle" && processingStage !== "ready" && processingStage !== "failed"}
                onClick={handleUseSamplePsd}
              >
                Use sample PSD
              </button>
            </div>

            {/* Staged progress view */}
            {processingStage !== "idle" && (
              <div
                className="panel stack"
                style={{
                  background: "var(--muted)",
                  border: "1px solid var(--border)",
                  padding: "16px",
                  borderRadius: "8px",
                  gap: "10px",
                }}
              >
                <div className="row spread" style={{ alignItems: "center" }}>
                  <div className="row" style={{ gap: "8px", alignItems: "center" }}>
                    {processingStage === "ready" ? (
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    ) : processingStage === "failed" ? (
                      <XCircle size={18} className="text-red-500" />
                    ) : (
                      <RotateCw size={18} className="animate-spin text-primary" />
                    )}
                    <span style={{ fontWeight: 600 }}>
                      {processingStage === "reading"
                        ? "1/5. Reading file bytes..."
                        : processingStage === "detecting"
                        ? "2/5. Detecting placeholder layers..."
                        : processingStage === "slicing"
                        ? "3/5. Slicing artwork layers in Web Worker..."
                        : processingStage === "uploading"
                        ? `4/5. Uploading slices (${uploadStats.completed} of ${uploadStats.total} assets)...`
                        : processingStage === "verifying"
                        ? "5/5. Verifying assets and committing version..."
                        : processingStage === "ready"
                        ? "Ready! PSD sliced and verified."
                        : "Slicing failed"}
                    </span>
                  </div>

                  {processingStage !== "ready" && processingStage !== "failed" && (
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={cancelUpload}
                    >
                      Cancel
                    </button>
                  )}
                  {processingStage === "failed" && originalFileRef.current && (
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={() =>
                        processPsdFile(originalFileRef.current!, manualPlaceholdersRef.current)
                      }
                    >
                      <RefreshCw size={13} /> Retry
                    </button>
                  )}
                </div>

                <progress
                  aria-label="Processing progress"
                  value={stageProgressPercent}
                  max={100}
                  style={{ width: "100%", height: "8px" }}
                />

                {/* PSD backup status */}
                <div className="row spread" style={{ fontSize: "0.82rem", color: "var(--muted-foreground)" }}>
                  <span>
                    PSD Backup:{" "}
                    {backupPsdStatus === "uploaded"
                      ? "Secured in private storage"
                      : backupPsdStatus === "uploading"
                      ? "Uploading backup in background..."
                      : backupPsdStatus === "failed"
                      ? "Backup upload deferred"
                      : "Pending"}
                  </span>
                  <span>{stageProgressPercent}%</span>
                </div>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <PlaceholderList
            event={event}
            manifest={manifest}
            validationIssues={validationIssues}
            compositeUrl={compositeUrl}
            previewUrl={event.artwork}
            onChange={(placeholders) => change({ placeholders })}
            onRescan={handleRescan}
            onUseFlattenedFallback={handleUseFlattenedFallback}
          />
        )}

        {step === 3 && (
          <div className="dual">
            <div className="preview-bed">
              <FlyerPreview event={event} manifest={manifest} sample />
            </div>
            <div className="stack">
              <h3>{event.title}</h3>
              <p>
                {event.date ? dateLabel(event.date) : ""} at {event.date ? event.date.slice(11) : ""}
              </p>
              <p>{event.description}</p>
              <p>
                {event.placeholders.length} customizable content slot(s)
              </p>
              <ShareLinkBox slug={event.slug} />
              <div className="row">
                <div
                  className="qr-box"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <span className="hint">Direct guest QR code</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="notice warn">
            {error}
          </p>
        )}

        <div className="row spread">
          {step ? (
            <button
              className="btn secondary"
              onClick={() => {
                setStep(step - 1);
                setError("");
              }}
            >
              Back
            </button>
          ) : (
            <Link href="/dashboard">Cancel</Link>
          )}

          {step === 3 && (
            <button
              className="btn secondary"
              onClick={() => {
                toast.success("Draft saved.");
                router.push(`/dashboard/events/${event.id}`);
              }}
            >
              Save as draft
            </button>
          )}

          <button
            className="btn primary"
            disabled={
              publishing ||
              (step === 1 && (!versionId || processingStage !== "ready"))
            }
            onClick={next}
          >
            {publishing
              ? "Publishing..."
              : step === 3
                ? "Publish"
                : "Continue"}
          </button>
        </div>
      </div>
    </>
  );
}
