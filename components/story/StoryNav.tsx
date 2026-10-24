"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Top right: the three story pages, then the one ink button on the page.
export function StoryNav() {
  const path = usePathname();
  return (
    <nav className="story-nav" aria-label="Pages">
      <Link href="/how-it-works" aria-current={path === "/how-it-works" ? "page" : undefined}>How it works</Link>
      <Link href="/plan" aria-current={path === "/plan" ? "page" : undefined}>Plan</Link>
      <Link href="/how-it-was-made" aria-current={path === "/how-it-was-made" ? "page" : undefined}>Making of</Link>
      <Link href="/book" className="story-cta">Book</Link>
    </nav>
  );
}
