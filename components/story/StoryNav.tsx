"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const dark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);

// Light or dark. It starts from the system setting, and a pick is kept for the next visit.
function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(dark() ? "dark" : "light"), []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="story-theme"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem("story-theme", next); } catch {}
        setTheme(next);
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === "dark" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
          </>
        ) : (
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
        )}
      </svg>
    </button>
  );
}

// Top right: the three story pages, then the one ink button on the page.
export function StoryNav() {
  const path = usePathname();
  return (
    <nav className="story-nav" aria-label="Pages">
      <Link href="/how-it-works" aria-current={path === "/how-it-works" ? "page" : undefined}>How it works</Link>
      <Link href="/plan" aria-current={path === "/plan" ? "page" : undefined}>Plan</Link>
      <Link href="/how-it-was-made" aria-current={path === "/how-it-was-made" ? "page" : undefined}>Making of</Link>
      <ThemeSwitch />
      <Link href="/book" className="story-cta">Book</Link>
    </nav>
  );
}
