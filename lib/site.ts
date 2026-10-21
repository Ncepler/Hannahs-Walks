/**
 * True in the GitHub Pages build: plain files, no server. Set by `scripts/build-pages.mjs` and inlined at
 * build time, so every server-backed branch below it is dead code in that build.
 */
export const STATIC_SITE = process.env.NEXT_PUBLIC_STATIC_SITE === "true";
