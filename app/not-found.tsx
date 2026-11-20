import { EmptyState, MarketingLayout } from "@/components/shell";
export default function Page() {
  return (
    <MarketingLayout>
      <main className="wrap work">
        <EmptyState
          title="Page not found"
          description="This link does not point to an available page."
        />
      </main>
    </MarketingLayout>
  );
}
