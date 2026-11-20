"use client";
import { useState } from "react";
import { CalendarDays, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { useEvents } from "./store";
import { FlyerPreview } from "./flyer";
import { PhotoUploader } from "./files";
import { EmptyState } from "./shell";
import { dateLabel } from "@/lib/mock-data";
export function Guest({ slug }: { slug: string }) {
  const { events } = useEvents();
  const event = events.find((e) => e.slug === slug && e.status === "Published");
  const [values, set] = useState<Record<string, string>>({});
  if (!event)
    return (
      <EmptyState
        title="Event unavailable"
        description="This event is unpublished or the link is no longer available."
      />
    );
  const filled = event.placeholders.filter((p) => values[p.id]?.trim()).length;
  const total = event.placeholders.length;
  const ready = total > 0 && filled === total;
  const fill = (id: string, v: string) => set((prev) => ({ ...prev, [id]: v }));
  return (
    <>
      <span className="crumb">
        <CalendarDays size={16} />
        {dateLabel(event.date)}
      </span>
      <h1>{event.title}</h1>
      <p className="lead mb-7">{event.description}</p>
      <div className="dual">
        <div className="preview-bed">
          <FlyerPreview
            event={event}
            values={values}
            onFocusField={(id) =>
              document
                .querySelector<HTMLInputElement>(
                  `#field-${CSS.escape(id)} input`,
                )
                ?.focus()
            }
          />
        </div>
        <section className="panel fields">
          <h2>Make it yours.</h2>
          <p>Add your details to the flyer. The design is already set.</p>
          <div className="row spread">
            <span role="status" className="hint">
              {filled} of {total} fields complete
            </span>
            {Object.values(values).some(Boolean) ? (
              <button
                className="underline"
                type="button"
                onClick={() => set({})}
              >
                Clear details
              </button>
            ) : (
              <button
                className="underline"
                type="button"
                onClick={() =>
                  set(
                    Object.fromEntries(
                      event.placeholders.map((p) => [
                        p.id,
                        p.type === "image"
                          ? "/jamie.png"
                          : (p.sampleValue || "Jamie Park").slice(
                              0,
                              p.options.maxLength ?? 40,
                            ),
                      ]),
                    ),
                  )
                }
              >
                Try sample details
              </button>
            )}
          </div>
          {[...event.placeholders]
            .sort(
              (a, b) => Number(a.type === "image") - Number(b.type === "image"),
            )
            .map((p) =>
              p.type === "text" ? (
                <label key={p.id} id={`field-${p.id}`}>
                  {p.key}
                  <input
                    maxLength={p.options.maxLength ?? 40}
                    placeholder={`Enter your ${p.key.toLowerCase()}`}
                    value={values[p.id] ?? ""}
                    onChange={(e) => fill(p.id, e.target.value)}
                  />
                  <small className="hint">
                    {values[p.id]?.length ?? 0} / {p.options.maxLength ?? 40}{" "}
                    characters
                  </small>
                </label>
              ) : (
                <div key={p.id} id={`field-${p.id}`}>
                  <PhotoUploader
                    name={p.key}
                    value={values[p.id] ?? ""}
                    onChange={(v) => fill(p.id, v)}
                  />
                </div>
              ),
            )}
          <span className="hint bar-inline">
            <LockKeyhole size={15} /> Your name and photo stay on your device.
          </span>
          <div className="row">
            {["Download PNG", "Download JPEG", "Share"].map((a, i) => (
              <Button
                key={a}
                variant={i ? "outline" : "default"}
                disabled={!ready}
                onClick={() => {
                  // TODO: wire to backend — connect final export and share actions.
                  toast.info(`${a}: preview only. No file has been exported.`);
                }}
              >
                {a}
              </Button>
            ))}
          </div>
          <p aria-live="polite" className="hint">
            {ready
              ? "Your personalized flyer is ready."
              : "Complete every field to unlock download and sharing."}
          </p>
        </section>
      </div>
    </>
  );
}
