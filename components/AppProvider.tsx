"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/store";

// Reads what this visitor may see from the server, and runs the scheduled jobs there every minute while a page is
// open, so holds expire and balances charge (U13 moves the jobs off the browser). Other tabs and other people change
// the data too, so it is read again whenever the tab comes back into view.
export function AppProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const app = useApp.getState();
    app.refresh();
    app.ensure();
    const timer = setInterval(() => useApp.getState().ensure(), 60_000);
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
