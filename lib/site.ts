/**
 * True in the GitHub Pages build: plain files, no server. Set by `scripts/build-pages.mjs` and inlined at
 * build time.
 */
export const STATIC_SITE = process.env.NEXT_PUBLIC_STATIC_SITE === "true";

/**
 * Where the planner lives when the page and the API are on different hosts, e.g. Pages calling a separate
 * server. Empty means this site's own server. Public by design: anyone can read it in the page source.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

/** Premium needs a server to plan with: this site's own, or the one named by NEXT_PUBLIC_API_BASE. */
export const PREMIUM_AVAILABLE = !STATIC_SITE || !!API_BASE;
