"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/store";

// Loads the demo data from localStorage (or seeds it), then runs the scheduled
// jobs every minute so holds expire and balances charge while the page is open.
export function AppProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    Promise.resolve(useApp.persist.rehydrate()).then(() => {
      useApp.getState().ensure();
      timer = setInterval(() => useApp.getState().ensure(), 60_000);
    });
    return () => clearInterval(timer);
  }, []);
  return <>{children}</>;
}
