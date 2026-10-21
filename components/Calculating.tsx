"use client";

import { useEffect, useState } from "react";

/**
 * The deliberate moment (§10.2): a turning ring and three status lines that cross-fade.
 * Used for the regular planner (about a second) and, later, for the real premium wait.
 */
export function Calculating({
  lines,
  stepMs,
  onCancel,
}: {
  lines: readonly string[];
  stepMs: number;
  onCancel: () => void;
}) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setI((n) => Math.min(n + 1, lines.length - 1)), stepMs);
    return () => window.clearInterval(t);
  }, [lines.length, stepMs]);

  return (
    <div role="status" className="card calc">
      <div className="spinner" aria-hidden="true">
        <svg viewBox="0 0 56 56" width="56" height="56">
          <circle cx="28" cy="28" r="22" fill="none" stroke="var(--line)" strokeWidth="3" />
          <circle
            cx="28"
            cy="28"
            r="22"
            fill="none"
            stroke="var(--forest)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="34 105"
          />
        </svg>
      </div>
      <div className="calc-lines" aria-hidden="true">
        {lines.map((line, k) => (
          <span key={line} className="calc-line" data-state={k === i ? "now" : k < i ? "past" : "next"}>
            {line}
          </span>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {lines[i]}
      </p>
      <button type="button" className="btn btn-text pressable" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
