import type { Metadata } from "next";
import { Geist_Mono, Shantell_Sans } from "next/font/google";
import Link from "next/link";
import { Roundel, Wordmark } from "@/components/Logo";
import { StoryNav } from "@/components/story/StoryNav";
import "./story.css";

// The explainer and the plan read like a long post: white paper, one column, hand-drawn diagrams.
// Shantell Sans is the diagram and margin-note hand only (approved by Colin, 23 Oct 2026).
const hand = Shantell_Sans({ subsets: ["latin"], weight: ["400"], variable: "--font-hand", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-story-mono", display: "swap" });

// Owner-facing pages on the public domain: reachable by link, kept out of search.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const THEME_SCRIPT = `try{var t=localStorage.getItem("story-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function StoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`story ${hand.variable} ${mono.variable}`}>
      {/* Apply a theme the reader picked before first paint, so a dark page never flashes white. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <Link href="/" className="story-mark" aria-label="Sunrise Sunset Tap Co., home">
        <span className="mark-full">
          <span className="on-light"><Wordmark height={30} /></span>
          <span className="on-dark"><Wordmark height={30} reversed /></span>
        </span>
        <span className="mark-small"><Roundel size={30} /></span>
      </Link>
      <StoryNav />
      <main>{children}</main>
    </div>
  );
}
