import type { CSSProperties } from "react";

/** Inline CSS custom properties, e.g. vars({ "--i": 3 }). */
export const vars = (v: Record<string, string | number>) => v as CSSProperties;
