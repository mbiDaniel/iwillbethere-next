"use client";
import { useRef, useSyncExternalStore } from "react";
import { Link2, Copy } from "lucide-react";
import { toast } from "sonner";
import type { Event } from "@/lib/types";
import { Badge } from "./ui/badge";
export function StatusBadge({ status }: { status: Event["status"] }) {
  return (
    <Badge variant={status === "Draft" ? "outline" : "secondary"}>
      {status}
    </Badge>
  );
}
export async function copyLink(slug: string) {
  try {
    await navigator.clipboard.writeText(`${location.origin}/e/${slug}`);
    toast.success("Guest link copied");
  } catch {
    toast.error("Copy unavailable. Select the guest URL and copy it manually.");
  }
}
const subscribe = () => () => {};
export function ShareLinkBox({ slug }: { slug: string }) {
  const origin = useSyncExternalStore(
    subscribe,
    () => location.origin,
    () => "",
  );
  return (
    <div className="stack">
      <label className="label">
        Guest link
        <input
          className="textinput"
          readOnly
          value={`${origin}/e/${slug}`}
          onFocus={(e) => e.target.select()}
        />
      </label>
      <button className="btn secondary" onClick={() => copyLink(slug)}>
        <Copy size={15} /> Copy link
      </button>
    </div>
  );
}
export function DeleteEvent({
  title,
  onDelete,
}: {
  title: string;
  onDelete: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="danger" onClick={() => dialog.current?.showModal()}>
        Delete event
      </button>
      <dialog
        className="native-dialog panel"
        ref={dialog}
        aria-label="Confirm event deletion"
      >
        <h2>Delete {title}?</h2>
        <p>This removes the event and its guest link from this demo session.</p>
        <div className="actions">
          <button
            className="btn secondary"
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              dialog.current?.close();
              onDelete();
              toast.success("Event deleted");
            }}
          >
            Delete event
          </button>
        </div>
      </dialog>
    </>
  );
}
export function CopyButton({ slug }: { slug: string }) {
  return (
    <button className="bar-inline" onClick={() => copyLink(slug)}>
      <Link2 size={15} /> Copy link
    </button>
  );
}
