import type { Mood } from "@/lib/types";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Two footprints in a rounded square. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" className="brand-mark">
      <rect width="28" height="28" rx="8" fill="var(--forest)" />
      <g fill="var(--on-forest)">
        <g transform="rotate(-10 9.5 11)">
          <ellipse cx="9.5" cy="9.2" rx="2.6" ry="3.6" />
          <ellipse cx="9.5" cy="14.6" rx="2" ry="1.7" />
        </g>
        <g transform="rotate(10 18.5 17)">
          <ellipse cx="18.5" cy="15.2" rx="2.6" ry="3.6" />
          <ellipse cx="18.5" cy="20.6" rx="2" ry="1.7" />
        </g>
      </g>
    </svg>
  );
}

/** Clear: three calm ripples. Workout: a ridge with a bolt. Ponder: one round tree. */
export function MoodIcon({ mood, size = 24 }: { mood: Mood; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      {mood === "clear" && (
        <>
          <path d="M4 9.5c2.7-2 5.3-2 8 0s5.3 2 8 0" />
          <path d="M4 14c2.7-2 5.3-2 8 0s5.3 2 8 0" />
          <path d="M4 18.5c2.7-2 5.3-2 8 0s5.3 2 8 0" />
        </>
      )}
      {mood === "workout" && (
        <>
          <path d="M2.5 19.5 9 9l4 6.5 2.5-3.5 6 7.5" />
          <path d="M16 3.5 13.2 8H17l-2.8 4.5" />
        </>
      )}
      {mood === "ponder" && (
        <>
          <circle cx="12" cy="9" r="5.5" />
          <path d="M12 14.5V20.5M8.5 20.5h7" />
        </>
      )}
    </svg>
  );
}

export function ChevronLeft({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
    </svg>
  );
}

export function Caution({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      <path d="M12 4 3 19.5h18L12 4Z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </svg>
  );
}

/** Faint contour lines: one blob scaled and nudged into rings. Decorative. */
export function Contours() {
  const blob =
    "M0,-60 C34,-62 66,-34 64,2 C62,36 34,62 -2,60 C-38,58 -66,32 -62,-2 C-58,-34 -34,-58 0,-60 Z";
  return (
    <svg className="contours" viewBox="0 0 400 260" aria-hidden="true" focusable="false">
      {[0, 1, 2, 3, 4, 5, 6].map((k) => (
        <path
          key={k}
          d={blob}
          transform={`translate(${290 + k * 3} ${120 - k * 2}) scale(${0.35 + k * 0.42} ${0.3 + k * 0.34})`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
