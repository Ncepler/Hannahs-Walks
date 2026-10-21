import type { NextConfig } from "next";

// `npm run build:pages` sets this and exports plain files for GitHub Pages. Pages cannot run API routes,
// the proxy or response headers, so the server-only files are set aside for that build.
const staticSite = process.env.NEXT_PUBLIC_STATIC_SITE === "true";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  ...(staticSite
    ? {
        output: "export",
        // Project pages live at /<repo>/; the workflow passes the path GitHub reports.
        basePath: process.env.PAGES_BASE_PATH ?? "",
        images: { unoptimized: true },
      }
    : {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                { key: "X-Robots-Tag", value: "noindex, nofollow" },
                { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
