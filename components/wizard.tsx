"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { events, dateLabel } from "@/lib/mock-data";
import { useEvents } from "./store";
import { FileDropzone } from "./files";
import { PlaceholderList } from "./placeholders";
import { ShareLinkBox } from "./event-controls";
import { FlyerPreview } from "./flyer";
import type { Event } from "@/lib/types";
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
  const { setEvents } = useEvents();
  const router = useRouter();
  const [step, setStep] = useState(0),
    [event, setEvent] = useState<Event>({
      ...events[0],
      title: "",
      description: "",
      date: "",
      count: 0,
      status: "Draft",
    }),
    [file, setFile] = useState<{ name: string; size: number } | null>(null),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  const change = (v: Partial<Event>) => setEvent((prev) => ({ ...prev, ...v }));
  useEffect(() => {
    if (!file || progress === 100) return;
    const timer = setTimeout(
      () => setProgress((p) => Math.min(100, p + 25)),
      160,
    );
    return () => clearTimeout(timer);
  }, [file, progress]);
  function choose(f: { name: string; size: number }) {
    // TODO: wire to backend — replace simulated PSD upload, progress, and preview.
    if (!f.name.toLowerCase().endsWith(".psd")) {
      setError("Choose a Photoshop .psd file.");
      setFile(null);
      return;
    }
    setError("");
    setProgress(0);
    setFile(f);
  }
  function next() {
    setError("");
    if (
      step === 0 &&
      (!event.title.trim() || !event.date || !event.description.trim())
    )
      return setError("Enter the title, date and time, and a description.");
    if (step === 0 && event.id === "after-hours") {
      const id = crypto.randomUUID();
      change({
        id,
        slug:
          (event.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "event") +
          "-" +
          id.slice(0, 7),
      });
    }
    if (step === 1 && (!file || progress < 100))
      return setError("Choose a PSD and wait for the demo upload.");
    if (
      step === 2 &&
      (!event.placeholders.length ||
        event.placeholders.some((p) => !p.key.trim()) ||
        new Set(event.placeholders.map((p) => p.key.trim())).size !==
          event.placeholders.length)
    )
      return setError(
        "Add at least one placeholder and give each a unique, nonempty key.",
      );
    if (step === 3) {
      // TODO: wire to backend — publish event and issue durable guest link.
      setEvents((all) => [...all, { ...event, status: "Published" }]);
      setDone(true);
      toast.success("Event published in this demo");
      return;
    }
    setStep(step + 1);
  }
  if (done)
    return (
      <section className="panel centered">
        <CheckCircle2 size={40} />
        <h1>Your event is ready.</h1>
        <p>{event.title} is published for this demo session.</p>
        <div className="actions">
          <Link className="btn primary" href={`/e/${event.slug}`}>
            Open guest page
          </Link>
          <Link className="btn secondary" href="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </section>
    );
  return (
    <>
      <h1>Create an event.</h1>
      <Stepper step={step} />
      <div className="panel stack">
        <h2>{steps[step]}</h2>
        {step === 0 && <DetailsFields event={event} change={change} />}{" "}
        {step === 1 && (
          <>
            <p>
              Choose your source file. This prototype uses sample artwork and
              layers.
            </p>
            <FileDropzone
              label="Choose or drop your PSD"
              accept=".psd"
              hint="Photoshop document (.psd)"
              onFile={choose}
            />
            <button
              className="btn secondary"
              onClick={() => choose({ name: "after-hours.psd", size: 5242880 })}
            >
              Use sample PSD
            </button>
            {file && (
              <div className="stack" role="status">
                <span>
                  {file.name} · {(file.size / 1048576).toFixed(1)} MB
                </span>
                <progress
                  aria-label="Simulated upload"
                  value={progress}
                  max={100}
                />
                <span className="hint">
                  {progress === 100
                    ? "Sample layers ready"
                    : `Uploading ${progress}%`}
                </span>
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <PlaceholderList
            event={event}
            onChange={(placeholders) => change({ placeholders })}
          />
        )}{" "}
        {step === 3 && (
          <div className="dual">
            <div className="preview-bed">
              <FlyerPreview event={event} sample />
            </div>
            <div className="stack">
              <h3>{event.title}</h3>
              <p>
                {dateLabel(event.date)} at {event.date.slice(11)}
              </p>
              <p>{event.description}</p>
              <p>
                {event.placeholders.length} locked content slots / {file?.name}
              </p>
              <ShareLinkBox slug={event.slug} />
              <div className="row">
                <QrCode size={38} />
                <span className="hint">QR code placeholder</span>
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
                setEvents((all) => [...all, { ...event, status: "Draft" }]);
                toast.success("Draft saved for this session");
                router.push(`/dashboard/events/${event.id}`);
              }}
            >
              Save as draft
            </button>
          )}
          <button className="btn primary" onClick={next}>
            {step === 3 ? "Publish" : "Continue"}
          </button>
        </div>
      </div>
    </>
  );
}
