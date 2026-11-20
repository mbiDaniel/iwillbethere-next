import { Skeleton } from "./ui/skeleton";
export function PageSkeletons() {
  return (
    <main
      className="wrap work stack"
      aria-busy="true"
      aria-label="Loading page"
    >
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-80 w-full" />
    </main>
  );
}
