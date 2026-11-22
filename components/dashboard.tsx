"use client";

import Link from "next/link";
import { MoreHorizontal, Plus } from "lucide-react";
import type { Event } from "@/lib/types";
import { dateLabel } from "@/lib/mock-data";
import { CopyButton, DeleteEvent, StatusBadge } from "./event-controls";
import { toast } from "sonner";
import { useState } from "react";
import { duplicateEvent, deleteEvent } from "@/lib/actions/events";
import { useRouter } from "next/navigation";

export function EventCard({
  event: e,
  onDuplicate,
  onDelete,
}: {
  event: Event;
  onDuplicate: (event: Event) => void;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();

  return (
    <article className="event-card">
      <Link
        className="event-thumb"
        aria-label={`Open ${e.title}`}
        href={`/dashboard/events/${e.id}`}
      >
        <img src={e.artwork} alt="" />
      </Link>
      <div className="event-info">
        <div className="row spread">
          <StatusBadge status={e.status} />
          <span className="hint">{e.date ? dateLabel(e.date) : "No date"}</span>
        </div>
        <Link href={`/dashboard/events/${e.id}`}>
          <h3>{e.title}</h3>
        </Link>
        <p className="hint">{e.count} flyers generated</p>
        <div className="row spread">
          {e.status === "Published" ? (
            <CopyButton slug={e.slug} />
          ) : (
            <span className="hint">Not shared yet</span>
          )}
          <details className="event-menu">
            <summary className="iconbtn" aria-label={`Actions for ${e.title}`}>
              <MoreHorizontal size={17} />
            </summary>
            <div className="menu-pop">
              <Link href={`/dashboard/events/${e.id}`}>Edit</Link>
              <button
                onClick={async (ev) => {
                  ev.currentTarget.closest("details")?.removeAttribute("open");
                  const res = await duplicateEvent(e.id);
                  if (res.ok) {
                    onDuplicate({
                      ...e,
                      id: res.data.id,
                      slug: res.data.slug,
                      title: e.title + " (copy)",
                      count: 0,
                      status: "Draft",
                    });
                    toast.success("Draft duplicated");
                    router.refresh();
                  } else {
                    toast.error(res.error);
                  }
                }}
              >
                Duplicate
              </button>
              <DeleteEvent
                title={e.title}
                onDelete={async () => {
                  const res = await deleteEvent(e.id);
                  if (res.ok) {
                    onDelete(e.id);
                    toast.success("Event deleted");
                    router.refresh();
                  } else {
                    toast.error(res.error);
                  }
                }}
              />
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

export function Dashboard({ initialEvents = [] }: { initialEvents?: Event[] }) {
  const [eventsList, setEventsList] = useState<Event[]>(initialEvents);

  return (
    <>
      <div className="section-title">
        <div>
          <h1>Your events.</h1>
          <p className="lead">Manage your designs and guest links.</p>
        </div>
        <Link className="btn primary" href="/dashboard/events/new">
          <Plus size={17} /> New event
        </Link>
      </div>
      {eventsList.length ? (
        <div className="event-grid">
          {eventsList.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              onDuplicate={(newEvent) =>
                setEventsList((prev) => [newEvent, ...prev])
              }
              onDelete={(id) =>
                setEventsList((prev) => prev.filter((x) => x.id !== id))
              }
            />
          ))}
        </div>
      ) : (
        <div className="panel centered">
          <h2>No events yet.</h2>
          <p>Create your first event to get started.</p>
        </div>
      )}
    </>
  );
}
