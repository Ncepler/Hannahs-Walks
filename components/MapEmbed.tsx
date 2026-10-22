"use client";

import { useState } from "react";

/**
 * Optional Google Maps Embed preview. Only rendered when a key is configured. It shows Google's
 * shortest path through the waypoints, which may differ from the route here, so it says "Preview".
 * Collapsed until opened (the app's own map is the primary one).
 */
export function MapEmbed({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card embed" data-open={open} aria-label="Map preview">
      <button type="button" className="embed-toggle pressable" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="eyebrow">Preview in Google Maps (Google picks its own path between pins)</span>
        <svg className="embed-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div className="embed-body">
        <iframe
          className="embed-frame"
          title="Walking route preview"
          src={src}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
        />
      </div>
    </section>
  );
}
