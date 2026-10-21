"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { placeTitle } from "@/lib/describe";
import { nodes, segmentBetween } from "@/lib/graph";
import type { Mood, NodeId } from "@/lib/types";
import { vars } from "./css";

interface Pt {
  x: number; // meters along the walk
  y: number; // ft
  node: NodeId;
}

function sample(path: readonly NodeId[]): { pts: Pt[]; total: number } {
  const pts: Pt[] = [];
  let x = 0;
  path.forEach((id, i) => {
    if (i > 0) x += segmentBetween(path[i - 1], id)?.meters ?? 0;
    pts.push({ x, y: nodes[id].elevFt, node: id });
  });
  return { pts, total: x };
}

/** Plain-language version of the line, for screen readers: turning points of 25 ft or more. */
function describeProfile(pts: Pt[]): string {
  const T = 25;
  const turns: Pt[] = [];
  let cand = pts[0];
  let dirn = 0;
  for (const p of pts.slice(1)) {
    if (dirn === 0) {
      if (Math.abs(p.y - cand.y) >= T) {
        dirn = Math.sign(p.y - cand.y);
        cand = p;
      }
    } else if (dirn > 0 ? p.y > cand.y : p.y < cand.y) {
      cand = p;
    } else if (Math.abs(cand.y - p.y) >= T) {
      turns.push(cand);
      dirn = -dirn;
      cand = p;
    }
  }
  if (dirn !== 0) turns.push(cand);

  let prev = pts[0].y;
  const phrases = turns.slice(0, 5).map((t) => {
    const where = placeTitle(t.node);
    const text = `${t.y > prev ? "climbs" : "drops"} to ${t.y} ft${where ? ` at ${where}` : ""}`;
    prev = t.y;
    return text;
  });
  return [`Starts at ${pts[0].y} ft`, ...phrases, `ends at ${pts[pts.length - 1].y} ft`].join(", ") + ".";
}

const PAD = { l: 8, r: 8, t: 24, b: 8 };

/** Sampled elevation along the walk: the nodes joined by straight lines. */
export function ElevationProfile({ path, mood }: { path: readonly NodeId[]; mood: Mood }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { pts, total } = useMemo(() => sample(path), [path]);
  const summary = useMemo(() => describeProfile(pts), [pts]);

  const { w, h } = size;
  const ready = w > 0 && h > 0;
  const lo = Math.min(...pts.map((p) => p.y));
  const hi = Math.max(...pts.map((p) => p.y));
  const span = Math.max(hi - lo, 24);
  const yMin = lo - span * 0.06;
  const yMax = yMin + span * 1.12;
  const sx = (x: number) => PAD.l + (x / total) * Math.max(w - PAD.l - PAD.r, 1);
  const sy = (y: number) => PAD.t + (1 - (y - yMin) / (yMax - yMin)) * Math.max(h - PAD.t - PAD.b, 1);

  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${sx(total).toFixed(1)} ${(h - PAD.b).toFixed(1)} L${sx(0).toFixed(1)} ${(h - PAD.b).toFixed(1)} Z`;

  // Pins: each landmark once (first visit) and the highest point, unless a landmark already marks it.
  const highest = pts.reduce((a, b) => (b.y > a.y ? b : a));
  const marks: { pt: Pt; label: string }[] = [];
  const seen = new Set<NodeId>();
  for (const p of pts) {
    const t = nodes[p.node].kind === "poi" ? placeTitle(p.node) : undefined;
    if (t && !seen.has(p.node)) {
      seen.add(p.node);
      marks.push({ pt: p, label: t });
    }
  }
  if (!marks.some((m) => Math.abs(m.pt.x - highest.x) < total * 0.04)) {
    marks.push({ pt: highest, label: `${highest.y} ft` });
  }
  marks.sort((a, b) => a.pt.x - b.pt.x);

  // Labels that would overlap the previous one are dropped; the pin stays.
  let lastRight = -Infinity;
  const labelled = marks.map((m) => {
    const width = m.label.length * 6.4 + 6;
    const cx = sx(m.pt.x);
    const left = Math.max(2, Math.min(cx - width / 2, w - width - 2));
    const show = left > lastRight + 4;
    if (show) lastRight = left + width;
    return { ...m, cx, left, width, show };
  });

  return (
    <figure className="profile-fig" style={{ color: `var(--${mood})` }}>
      <figcaption className="eyebrow">Elevation (sampled)</figcaption>
      <div className="profile" ref={box}>
        {ready && (
          <svg className="profile-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
            <path d={area} fill="currentColor" fillOpacity="0.14" />
            <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {labelled.map((m, i) => (
              <g key={m.pt.node + i} className="pin" style={vars({ "--k": i })}>
                <line x1={m.cx} x2={m.cx} y1={sy(m.pt.y)} y2={sy(m.pt.y) - 7} stroke="currentColor" strokeWidth="1.25" />
                <circle cx={m.cx} cy={sy(m.pt.y)} r="3.5" fill="var(--surface-solid)" stroke="currentColor" strokeWidth="2" />
                {m.show && (
                  <text x={m.left} y={sy(m.pt.y) - 11} className="pin-label">
                    {m.label}
                  </text>
                )}
              </g>
            ))}
          </svg>
        )}
      </div>
      <p className="sr-only">{summary}</p>
    </figure>
  );
}
