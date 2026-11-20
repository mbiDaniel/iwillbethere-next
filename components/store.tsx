"use client";
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { events as seed } from "@/lib/mock-data";
import type { Event } from "@/lib/types";
const Context = createContext<{
  events: Event[];
  setEvents: Dispatch<SetStateAction<Event[]>>;
} | null>(null);
export function MockProvider({ children }: { children: ReactNode }) {
  // TODO: wire to backend — replace session-only event reads and mutations.
  const [events, setEvents] = useState(seed);
  return (
    <Context.Provider value={{ events, setEvents }}>
      {children}
    </Context.Provider>
  );
}
export function useEvents() {
  const value = useContext(Context);
  if (!value) throw Error("Missing event provider");
  return value;
}
