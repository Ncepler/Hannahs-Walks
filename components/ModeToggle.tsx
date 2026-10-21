"use client";

import { useRef } from "react";
import { COPY } from "@/lib/config";

export type Mode = "regular" | "premium";

const OPTIONS: { value: Mode; label: string; sub: string }[] = [
  { value: "regular", ...COPY.toggleRegular },
  { value: "premium", ...COPY.togglePremium },
];

/** Two-option segmented control. A UI mode switch only: no payment, no account. */
export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = mode === "regular" ? 0 : 1;

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % 2
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i + 1) % 2
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(OPTIONS[next].value);
  };

  return (
    <div role="radiogroup" aria-label="Plan" className="toggle">
      <span
        className="toggle-thumb"
        aria-hidden="true"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={mode === o.value}
          tabIndex={mode === o.value ? 0 : -1}
          className="toggle-opt"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <span className="toggle-label">{o.label}</span>
          <span className="toggle-sub">{o.sub}</span>
        </button>
      ))}
    </div>
  );
}
