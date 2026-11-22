import { EventDetail } from "@/components/event-detail";
import { requireUser } from "@/lib/auth";
import { getUserEventById } from "@/lib/data/events";
import { notFound, redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/login?redirect=/dashboard/events/${eventId}`);
  }

  const eventData = await getUserEventById(user.id, eventId);
  if (!eventData) {
    notFound();
  }

  return <EventDetail initialEvent={eventData} />;
}
