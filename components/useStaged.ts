"use client";

import { useEffect, useState } from "react";

export type StagePhase = "pre" | "in" | "out";

/**
 * Swaps `value` in two beats: the old one leaves (`out`), the new one is mounted at its
 * starting pose (`pre`, no transition) and then released (`in`). Driven by transitions, so a
 * change mid-way retargets from wherever the element is instead of restarting.
 */
export function useStaged<T>(value: T, outMs: number, initialEnter = false) {
  const [shown, setShown] = useState(value);
  const [phase, setPhase] = useState<StagePhase>(initialEnter ? "pre" : "in");

  useEffect(() => {
    if (Object.is(value, shown)) {
      // Interrupted on the way out and sent back to what is still on screen.
      setPhase((p) => (p === "out" ? "in" : p));
      return;
    }
    setPhase("out");
    const t = window.setTimeout(() => {
      setShown(value);
      setPhase("pre");
    }, outMs);
    return () => window.clearTimeout(t);
  }, [value, shown, outMs]);

  useEffect(() => {
    if (phase !== "pre") return;
    let r2 = 0;
    // Two frames so the starting pose is painted before the transition is released.
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setPhase("in"));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [phase]);

  return { shown, phase };
}
