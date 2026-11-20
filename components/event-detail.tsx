"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useEvents } from "./store";
import { EmptyState } from "./shell";
import { StatusBadge, ShareLinkBox, DeleteEvent } from "./event-controls";
import { PlaceholderList } from "./placeholders";
import { FileDropzone } from "./files";
import { DetailsFields } from "./wizard";
import type { Event } from "@/lib/types";
export function EventDetail({ id }: { id: string }) {
  const { events, setEvents } = useEvents(),
    e = events.find((x) => x.id === id);
  const [tab, setTab] = useState("Overview");
  const router = useRouter();
  if (!e)
    return (
      <EmptyState
        title="Event not found"
        description="This event may have been deleted or the demo was refreshed."
      />
    );
  const change = (v: Partial<Event>) =>
    setEvents((all) => all.map((x) => (x.id === id ? { ...x, ...v } : x)));
  return (
    <>
      <StatusBadge status={e.status} />
      <h1>{e.title}</h1>
      <nav className="tabs" aria-label="Event sections">
        {["Overview", "Placeholders", "Fonts", "Settings"].map((t) => (
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
          </div>
          <div className="panel stack">
            <h2>Guest access</h2>
            {e.status === "Published" ? (
              <>
                <ShareLinkBox slug={e.slug} />
                <Link href={`/e/${e.slug}`} className="btn primary">
                  Open guest page
                </Link>
                <button
                  className="btn secondary"
                  onClick={() => {
                    change({ status: "Draft" });
                    toast.success(
                      "Moved to draft. The guest link is now unavailable.",
                    );
                  }}
                >
                  Unpublish event
                </button>
              </>
            ) : (
              <>
                <p>
                  Publish this draft to enable guest access in this session.
                </p>
                <button
                  className="btn primary"
                  disabled={
                    !e.placeholders.length ||
                    new Set(e.placeholders.map((p) => p.key.trim())).size !==
                      e.placeholders.length ||
                    e.placeholders.some((p) => !p.key.trim())
                  }
                  onClick={() => change({ status: "Published" })}
                >
                  Publish draft
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
          save={(placeholders) => change({ placeholders })}
        />
      )}{" "}
      {tab === "Fonts" && (
        <section className="panel stack">
          <h2>Event fonts</h2>
          <p>
            {e.fonts.length
              ? "Fonts added to this event."
              : "No font files yet. The sample uses a system fallback."}
          </p>
          {e.fonts.map((f) => (
            <div key={f.name} className="row spread">
              <strong>{f.name}</strong>
              <span>{f.status}</span>
            </div>
          ))}
          <FileDropzone
            label="Choose a font file"
            hint="OTF, TTF or WOFF2"
            accept=".otf,.ttf,.woff2"
            onFile={(f) => {
              // TODO: wire to backend — validate font files and resolve family metadata.
              if (!/\.(otf|ttf|woff2)$/i.test(f.name))
                return void toast.error("Choose an OTF, TTF, or WOFF2 font.");
              const name = f.name.replace(/\.[^.]+$/, "");
              change({
                fonts: [
                  ...e.fonts.filter((x) => x.name !== name),
                  { name, status: "Added (demo)" },
                ],
              });
              toast.success("Font added to demo list");
            }}
          />
        </section>
      )}
      {tab === "Settings" && (
        <div className="stack">
          <section className="panel stack">
            <h2>Event details</h2>
            <EditDetails event={e} save={change} />
          </section>
          <section className="panel stack">
            <h2>Danger zone</h2>
            <p>Remove this event from your demo workspace.</p>
            <div>
              <DeleteEvent
                title={e.title}
                onDelete={() => {
                  setEvents((all) => all.filter((x) => x.id !== id));
                  router.push("/dashboard");
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
  save,
}: {
  event: Event;
  save: (layers: Event["placeholders"]) => void;
}) {
  const [layers, setLayers] = useState(event.placeholders);
  const dirty = layers !== event.placeholders;
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
          disabled={!dirty || !valid}
          onClick={() => {
            save(layers);
            toast.success("Layer changes saved for this session");
          }}
        >
          Save layer changes
        </button>
        <button
          className="btn secondary"
          disabled={!dirty}
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
  save: (v: Partial<Event>) => void;
}) {
  const [draft, setDraft] = useState(event);
  return (
    <form
      className="fields"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!draft.title.trim() || !draft.description.trim()) {
          toast.error("Enter a title and description.");
          return;
        }
        save({
          title: draft.title,
          date: draft.date,
          description: draft.description,
        });
        toast.success("Changes saved for this session");
      }}
    >
      <DetailsFields
        event={draft}
        change={(v) => setDraft((p) => ({ ...p, ...v }))}
      />
      <button className="btn secondary">Save changes</button>
    </form>
  );
}
