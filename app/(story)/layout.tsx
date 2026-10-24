import type { Metadata } from "next";
import { Geist_Mono, Shantell_Sans } from "next/font/google";
import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { StoryNav } from "@/components/story/StoryNav";
import "./story.css";

// The explainer and the plan read like a long post: white paper, one column, hand-drawn diagrams.
// Shantell Sans is the diagram and margin-note hand only (approved by Colin, 23 Oct 2026).
const hand = Shantell_Sans({ subsets: ["latin"], weight: ["400"], variable: "--font-hand", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-story-mono", display: "swap" });

// Owner-facing pages on the public domain: reachable by link, kept out of search.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function StoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`story ${hand.variable} ${mono.variable}`}>
      <Link href="/" className="story-mark" aria-label="Sunrise Sunset Tap Co., home">
        <Wordmark height={30} />
      </Link>
      <StoryNav />
      <main>{children}</main>
    </div>
  );
}
