import { EventDetail } from "@/components/event-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  return <EventDetail id={(await params).eventId} />;
}
