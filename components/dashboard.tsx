"use client";
import Link from "next/link";
import { MoreHorizontal, Plus } from "lucide-react";
import type { Event } from "@/lib/types";
import { useEvents } from "./store";
import { dateLabel } from "@/lib/mock-data";
import { CopyButton, DeleteEvent, StatusBadge } from "./event-controls";
import { toast } from "sonner";
export function EventCard({ event: e }: { event: Event }) {
  const { setEvents } = useEvents();
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
          <span className="hint">{dateLabel(e.date)}</span>
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
                onClick={(ev) => {
                  const id = crypto.randomUUID();
                  setEvents((all) => [
                    ...all,
                    {
                      ...e,
                      id,
                      slug: id,
                      title: e.title + " (copy)",
                      count: 0,
                      status: "Draft",
                    },
                  ]);
                  ev.currentTarget.closest("details")?.removeAttribute("open");
                  toast.success("Draft duplicated");
                }}
              >
                Duplicate
              </button>
              <DeleteEvent
                title={e.title}
                onDelete={() =>
                  setEvents((all) => all.filter((x) => x.id !== e.id))
                }
              />
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}
export function Dashboard() {
  const { events } = useEvents();
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
      {events.length ? (
        <div className="event-grid">
          {events.map((e) => (
            <EventCard key={e.id} event={e} />
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
