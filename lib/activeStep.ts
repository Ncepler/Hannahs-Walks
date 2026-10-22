"use client";

import { useSyncExternalStore } from "react";

/**
 * The step the person marked as "You are here". One value shared by the Directions list and the map's numbered
 * markers, so tapping either moves the other. Nothing is stored and nothing leaves the page.
 */
let step: number | null = null;
const listeners = new Set<() => void>();

export function setActiveStep(next: number | null) {
  if (next === step) return;
  step = next;
  listeners.forEach((l) => l());
}

export function useActiveStep(): number | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => step,
    () => null,
  );
}
