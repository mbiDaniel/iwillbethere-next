import { Guest } from "@/components/guest";
import { MarketingLayout } from "@/components/shell";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <MarketingLayout>
      <main className="wrap work">
        <Guest key={slug} slug={slug} />
      </main>
    </MarketingLayout>
  );
}
