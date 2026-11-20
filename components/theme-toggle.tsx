"use client";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
function subscribe(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}
export function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribe,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return (
    <button
      className="iconbtn"
      aria-label={dark ? "Use light mode" : "Use dark mode"}
      onClick={() => document.documentElement.classList.toggle("dark")}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
