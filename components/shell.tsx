import Link from "next/link";
import { Asterisk, ArrowUpRight, LayoutGrid } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
export function Brand() {
  return (
    <Link className="brand" href="/">
      <span className="mark">
        <Asterisk strokeWidth={3.6} />
      </span>
      I Will Be There<span className="brand-dot">.</span>
    </Link>
  );
}
export function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="top">
        <div className="wrap bar">
          <Brand />
          <nav aria-label="Main navigation">
            <Link className="navmore" href="/#how">
              How it works
            </Link>
            <Link className="navmore" href="/guide">
              Designer guide
            </Link>
            <ThemeToggle />
            <Link href="/login" className="login">
              Log in <ArrowUpRight size={15} />
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="wrap foot">
        <Brand />
        <div>
          <Link href="/guide">Designer guide</Link>
          <Link href="/dashboard">Dashboard</Link>
        </div>
      </footer>
    </>
  );
}
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <MarketingLayout>
      <main className="wrap work">
        <Link className="crumb" href="/dashboard">
          <LayoutGrid size={15} /> Designer workspace
        </Link>
        {children}
      </main>
    </MarketingLayout>
  );
}
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="panel centered">
      <h2>{title}</h2>
      <p>{description}</p>
      <Link className="btn secondary" href="/">
        Back to home
      </Link>
    </section>
  );
}
