import { useId } from "react";

// Railway roundel holding the hill: stepped sky bands, a sun half over the horizon, the hill in ink.
// One drawing, with a per-instance clip id so two roundels on a page don't share one.
function RoundelArt() {
  const clip = useId().replace(/:/g, "");
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <circle cx="70" cy="70" r="66" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="140" height="140" fill="#2B6CB0" />
        <rect y="44" width="140" height="12" fill="#E2612B" />
        <rect y="56" width="140" height="12" fill="#F2B33D" />
        <rect y="68" width="140" height="12" fill="#E9D3A6" />
        <circle cx="70" cy="86" r="30" fill="#FAF4E6" />
        <path d="M0 140 L0 92 Q 70 66 140 92 L140 140 Z" fill="#16264A" />
        <path d="M18 140 Q 64 100 98 140 Z" fill="#2B6CB0" />
      </g>
      <circle cx="70" cy="70" r="66" fill="none" stroke="#16264A" strokeWidth="5" />
    </>
  );
}

export function Roundel({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" aria-hidden="true">
      <RoundelArt />
    </svg>
  );
}

// Stacked name: SUNRISE over SUNSET with the horizon rule between them.
export function Wordmark({ height = 44, reversed = false }: { height?: number; reversed?: boolean }) {
  const fg = reversed ? "#FAF4E6" : "#16264A";
  return (
    <svg height={height} viewBox={height >= 77 ? "0 0 300 64" : "0 0 184 64"} role="img" aria-label="Sunrise Sunset Tap Co.">
      <g transform="translate(0 0)">
        <Roundel64 />
      </g>
      <g fontFamily="var(--font-display), 'Big Shoulders Display', sans-serif" fontWeight="900" fill={fg}>
        <text x="76" y="28" fontSize="27" letterSpacing="0.5">SUNRISE</text>
        <rect x="77" y="33" width="104" height="2" fill={reversed ? "#F2B33D" : fg} />
        <text x="76" y="60" fontSize="27" letterSpacing="0.5">SUNSET</text>
      </g>
      {/* 10 units only reaches the 12px label floor from 77px tall, so smaller lockups drop it. */}
      {height >= 77 && (
        <text x="186" y="59" fontFamily="var(--font-label), 'Josefin Sans', sans-serif" fontWeight="700" fontSize="10" letterSpacing="2" fill={reversed ? "#F2B33D" : "#16264A"}>
          TAP CO.
        </text>
      )}
    </svg>
  );
}

function Roundel64() {
  return (
    <svg x="0" y="0" width="64" height="64" viewBox="0 0 140 140">
      <RoundelArt />
    </svg>
  );
}

export { Roundel as Logo };
