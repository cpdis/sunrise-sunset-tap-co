// Sun rising over the hill, cut by the three running stripes.
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <clipPath id="sst-sun">
          <rect x="0" y="0" width="48" height="31" />
        </clipPath>
      </defs>
      <circle cx="24" cy="31" r="15" fill="#F2C14E" clipPath="url(#sst-sun)" />
      <rect x="6" y="20" width="36" height="2.2" fill="#1F2A44" />
      <rect x="6" y="25" width="36" height="2.2" fill="#1F2A44" />
      <path d="M2 40 C 12 30, 22 29, 30 33 S 42 38, 46 36 L 46 46 L 2 46 Z" fill="#C8553D" />
      <path d="M2 43 C 14 37, 26 37, 46 41 L 46 46 L 2 46 Z" fill="#EE8A3C" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="brand">
      <Logo />
      <span className="name">Sunrise Sunset Tap Co.</span>
    </span>
  );
}
