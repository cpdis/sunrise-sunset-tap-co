"use client";

import { useEffect } from "react";
import { STORAGE_KEY, useApp } from "@/lib/store";

// Loads the demo data from localStorage (or seeds it), then runs the scheduled
// jobs every minute so holds expire and balances charge while the page is open.
// Other tabs share the same storage, so re-read it whenever they write and before each tick.
export function AppProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) useApp.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    Promise.resolve(useApp.persist.rehydrate()).then(() => {
      useApp.getState().ensure();
      timer = setInterval(async () => {
        await useApp.persist.rehydrate();
        useApp.getState().ensure();
      }, 60_000);
    });
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return <>{children}</>;
}
