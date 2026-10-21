"use client";

import { useMemo } from "react";
import { placeTitle } from "@/lib/describe";
import { nodes, segments, segmentBetween } from "@/lib/graph";
import type { Mood, NodeId } from "@/lib/types";

const W = 320;
const H = 280;
const PAD = 22;
/** Smallest span drawn, in degrees of latitude, so short walks are not blown up. */
const MIN_SPAN = 0.006;

/**
 * A straight-segment diagram of the walk. Equirectangular, scaled by cos(lat).
 * It is not a map: roads are not curved and nothing is to scale beyond the layout.
 */
export function RouteSketch({ path, mood }: { path: readonly NodeId[]; mood: Mood }) {
  const geo = useMemo(() => {
    const k = Math.cos((nodes.HOME.lat * Math.PI) / 180);
    const px = (id: NodeId) => nodes[id].lon * k;
    const py = (id: NodeId) => -nodes[id].lat;
    const xs = path.map(px);
    const ys = path.map(py);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, MIN_SPAN);
    const scale = Math.min(W - 2 * PAD, H - 2 * PAD) / span;
    const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
    const oy = (H - (maxY - minY) * scale) / 2 - minY * scale;
    const at = (id: NodeId) => ({ x: px(id) * scale + ox, y: py(id) * scale + oy });

    const walked = new Set<string>();
    const route: string[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const seg = segmentBetween(path[i], path[i + 1]);
      if (!seg || walked.has(seg.id)) continue;
      walked.add(seg.id);
      const a = at(seg.a);
      const b = at(seg.b);
      route.push(`M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
    }
    const context = segments
      .filter((s) => !walked.has(s.id))
      .map((s) => {
        const a = at(s.a);
        const b = at(s.b);
        return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      })
      .join("");

    const turnarounds = new Set<NodeId>();
    for (let i = 1; i < path.length - 1; i++) if (path[i - 1] === path[i + 1]) turnarounds.add(path[i]);
    const places = [...new Set(path.filter((id) => nodes[id].kind === "poi"))];
    return { at, route: route.join(""), context, turnarounds: [...turnarounds].slice(0, 4), places };
  }, [path]);

  const label = (id: NodeId, text: string) => {
    const p = geo.at(id);
    const right = p.x > W * 0.6;
    return (
      <text key={`l-${id}`} x={p.x + (right ? -11 : 11)} y={p.y + 4} textAnchor={right ? "end" : "start"} className="sketch-label">
        {text}
      </text>
    );
  };

  return (
    <figure className="sketch-fig" style={{ color: `var(--${mood})` }}>
      <figcaption className="eyebrow">Route sketch</figcaption>
      <svg
        className="sketch"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Route sketch. A straight-line diagram of the walk, not a map."
      >
        <path d={geo.context} fill="none" stroke="var(--line)" strokeWidth="1.5" strokeLinecap="round" />
        <path d={geo.route} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        {geo.turnarounds.map((id) => {
          const p = geo.at(id);
          return <circle key={`t-${id}`} cx={p.x} cy={p.y} r="9" fill="none" stroke="var(--ink)" strokeWidth="1.75" />;
        })}
        {geo.places.map((id) => {
          const p = geo.at(id);
          return (
            <rect
              key={`p-${id}`}
              x={p.x - 5}
              y={p.y - 5}
              width="10"
              height="10"
              transform={`rotate(45 ${p.x} ${p.y})`}
              fill="var(--sun)"
              stroke="var(--ink)"
              strokeWidth="1.5"
            />
          );
        })}
        <circle cx={geo.at("HOME").x} cy={geo.at("HOME").y} r="6.5" fill="var(--ink)" />
        {label("HOME", "Home")}
        {geo.places.map((id) => label(id, placeTitle(id) ?? ""))}
      </svg>
      <p className="legend" aria-hidden="true">
        <span>● Home</span>
        <span>◆ Place</span>
        <span>○ Turnaround</span>
      </p>
    </figure>
  );
}
