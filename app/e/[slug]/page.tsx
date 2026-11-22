import { Metadata } from "next";
import { Guest } from "@/components/guest";
import { MarketingLayout, EmptyState } from "@/components/shell";
import { getPublishedEventBySlug } from "@/lib/data/events";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getPublishedEventBySlug(slug);

  if (!event) {
    return {
      title: "Event not found — I Will Be There",
    };
  }

  return {
    title: `${event.title} — Personalized event flyer`,
    description: event.description,
    openGraph: {
      title: `${event.title} — I Will Be There`,
      description: event.description,
      images: [event.artwork],
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getPublishedEventBySlug(slug);

  if (!event) {
    return (
      <MarketingLayout>
        <main className="wrap work">
          <EmptyState
            title="Event unavailable"
            description="This event is unpublished or the link is no longer available."
          />
        </main>
      </MarketingLayout>
    );
  }

  return (
    <MarketingLayout>
      {event.manifestUrl && (
        <link rel="preload" href={event.manifestUrl} as="fetch" crossOrigin="anonymous" />
      )}
      <main className="wrap work">
        <Guest key={slug} event={event} />
      </main>
    </MarketingLayout>
  );
}
