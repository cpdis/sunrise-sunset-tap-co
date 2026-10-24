"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/store";

// Reads what this visitor may see from the server. Other tabs, other people and the daily jobs (app/api/jobs) change
// the data too, so it is read again every minute and whenever the tab comes back into view. The browser runs no jobs.
export function AppProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const app = useApp.getState();
    app.refresh();
    const timer = setInterval(() => useApp.getState().refresh(), 60_000);
    const onShow = () => {
      if (document.visibilityState === "visible") useApp.getState().refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, []);
  return <>{children}</>;
}
