/**
 * Lets a page on another host (the GitHub Pages site) call these routes. Off unless ALLOWED_ORIGIN lists
 * its origin, e.g. https://ncepler.github.io (scheme and host, no path). Only a listed origin is echoed
 * back, never a wildcard, and no cookies are involved: callers send a bearer token instead.
 */
const listed = () =>
  (process.env.ALLOWED_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !listed().includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/** The answer to a browser's preflight question. */
export const preflight = (req: Request) => new Response(null, { status: 204, headers: corsHeaders(req) });
