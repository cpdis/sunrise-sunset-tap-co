"use client";

import { useEffect, useRef, useState } from "react";

// Silent lithograph loops. They only load and play when the viewer hasn't asked for reduced motion or
// data saving, start when scrolled into view, and always carry a pause control (WCAG 2.2.2).
export function LoopVideo({ src, poster, label, className }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [allowed, setAllowed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const save = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    setAllowed(!reduce && !save);
    setPlaying(!reduce && !save);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !allowed) return;
    if (playing && visible) el.play().catch(() => setPlaying(false));
    else el.pause();
  }, [playing, visible, allowed]);

  return (
    <div className="vwrap">
      <video
        ref={ref}
        className={className}
        src={allowed && (visible || playing) ? src : undefined}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        aria-label={label}
      />
      {allowed && (
        <button type="button" className="video-toggle" aria-pressed={!playing} onClick={() => setPlaying(!playing)}>
          {playing ? "Pause" : "Play"}
        </button>
      )}
    </div>
  );
}
