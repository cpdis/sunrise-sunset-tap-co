"use client";

import { useEffect, useRef, useState } from "react";

// Silent lithograph loops. They only load and play when the viewer hasn't asked for reduced motion or
// data saving, play only while on screen. No pause control (Colin's call, 22 Oct 2026); reduced motion
// gets the still poster instead.
// `rate` slows a loop without a re-encode (0.7 turns the 7 s hero loop into 10 s).
export function LoopVideo({ src, poster, label, className, rate = 1 }: { src: string; poster: string; label: string; className?: string; rate?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false); // keep the source once loaded so scrolling back doesn't refetch

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const save = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    setAllowed(!reduce && !save);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { setVisible(e.isIntersecting); if (e.isIntersecting) setSeen(true); }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !allowed) return;
    // a new src resets playbackRate to defaultPlaybackRate, so set both
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
    if (visible) el.play().catch(() => {});
    else el.pause();
  }, [visible, allowed, rate]);

  return (
    <div className="vwrap">
      <video
        ref={ref}
        className={className}
        src={allowed && seen ? src : undefined}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        aria-label={label}
      />
    </div>
  );
}
