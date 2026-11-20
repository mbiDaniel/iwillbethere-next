"use client";
export default function Page({ reset }: { reset: () => void }) {
  return (
    <main className="wrap work centered">
      <h1>Something went wrong.</h1>
      <p>The preview could not load.</p>
      <button className="btn secondary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
