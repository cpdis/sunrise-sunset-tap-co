"use client";

// A page of the live demo in a browser frame. Wide screens see it at laptop size, scaled to fit;
// phones see it at their own width. The iframe loads when the frame comes near the viewport.
import { useEffect, useRef, useState } from "react";

const APP_W = 1280;

export function Frame({ src, title, height = 720, phoneHeight = 620 }: { src: string; title: string; height?: number; phoneHeight?: number }) {
  const view = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  const [load, setLoad] = useState(false);
  const [shown, setShown] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    const el = view.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setLoad(true), io.disconnect()), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const phone = W > 0 && W < 600;
  const s = phone ? 1 : W / APP_W;
  const appH = phone ? phoneHeight : height;

  return (
    <figure className="frame">
      <div className="frame-bar">
        <span className="dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="url">sunrisesunsettapco.cpd.dev{src}</span>
        <button type="button" className="fbtn" aria-label="Start this view again" title="Start again" onClick={() => { setShown(false); setN(n + 1); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9L20 8" /><path d="M20 3.5V8h-4.5" /><path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L4 16" /><path d="M4 20.5V16h4.5" /></svg>
        </button>
        <a className="fbtn" href={src} target="_blank" rel="noopener" aria-label="Open in a new tab" title="Open in a new tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></svg>
        </a>
      </div>
      <div ref={view} className="frame-view" style={{ height: Math.round(appH * s) || appH }}>
        {load && W > 0 && (
          <iframe
            key={n}
            src={src}
            title={title}
            onLoad={() => setShown(true)}
            style={{ width: phone ? W : APP_W, height: appH, transform: `scale(${s})` }}
          />
        )}
        <div className={`frame-cover${shown ? " gone" : ""}`} aria-hidden="true">Loading the demo…</div>
      </div>
    </figure>
  );
}
