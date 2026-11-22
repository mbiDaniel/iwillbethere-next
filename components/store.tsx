"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Event } from "@/lib/types";

interface EventContextValue {
  events: Event[];
  setEvents: Dispatch<SetStateAction<Event[]>>;
  refreshEvents?: () => Promise<void>;
}

const Context = createContext<EventContextValue | null>(null);

export function MockProvider({
  children,
  initialEvents = [],
}: {
  children: ReactNode;
  initialEvents?: Event[];
}) {
  const [events, setEvents] = useState<Event[]>(initialEvents);

  return (
    <Context.Provider value={{ events, setEvents }}>
      {children}
    </Context.Provider>
  );
}

export function useEvents() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing event provider");
  return value;
}
