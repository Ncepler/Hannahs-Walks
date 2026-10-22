"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { setActiveStep, useActiveStep } from "@/lib/activeStep";
import { MAP_ATTRIBUTION, MAP_COPY } from "@/lib/config";
import { fitView, makeProjector, niceScaleBarM, type View } from "@/lib/geo";
import { nodes } from "@/lib/graph";
import { BARRIERS, NETWORK, buildScene } from "@/lib/mapScene";
import type { Mood, NodeId } from "@/lib/types";
import { Caution } from "./icons";

// Loaded only when the person switches the street background on (MapLibre is large and needs WebGL).
const BasemapLayer = dynamic(() => import("./BasemapLayer"), { ssr: false });

type XY = readonly [number, number];
const MAX_SCALE = 4; // px per metre: 1 px = 0.25 m
const PAD = 24;
const HOME = nodes.HOME;
const project = makeProjector([HOME.lat, HOME.lon]);

const NETWORK_XY = NETWORK.map((n) => ({ ...n, xy: n.pts.map(project) }));
const BARRIERS_XY = BARRIERS.map((b) => ({ ...b, xy: b.pts.map(project) }));

const cumXY = (pts: readonly XY[]): number[] => {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  return c;
};

/** Point and heading (radians, screen-down y) at `d` metres along a projected polyline. */
function atXY(pts: readonly XY[], cum: readonly number[], d: number): { x: number; y: number; a: number } {
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < d) i++;
  const p = pts[i - 1]!;
  const q = pts[i]!;
  const span = cum[i]! - cum[i - 1]!;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, (d - cum[i - 1]!) / span));
  return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t, a: Math.atan2(q[1] - p[1], q[0] - p[0]) };
}

const pathD = (pts: readonly XY[], sx: (x: number) => number, sy: (y: number) => number) =>
  pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join("");

export interface RouteMapProps {
  path: readonly NodeId[];
  mood: Mood;
  mode: "preview" | "full";
  /** Preview only: opens the full map. */
  onExpand?: () => void;
  /** Metres along the walk under the elevation profile's scrub, or null. */
  scrubM?: number | null;
  /** Full mode with the street background on. */
  basemap?: boolean;
  /** MapLibre could not start (no WebGL, style failed): the caller turns the toggle off. */
  onBasemapFail?: () => void;
}

/**
 * The route on a real street map, drawn from stored geometry (ROADS-ADDENDUM §7). Nothing is smoothed or guessed:
 * a segment without stored geometry is a dashed chord and the map says "Approximate". The roads the app will not
 * use are always drawn, dashed, as "Not walked".
 */
export function RouteMap({ path, mood, mode, onExpand, scrubM = null, basemap = false, onBasemapFail }: RouteMapProps) {
  const full = mode === "full";
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const active = useActiveStep();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scene = useMemo(() => buildScene(path), [path]);
  const routeXY = useMemo(() => scene.route.points.map(project), [scene]);
  const routeCum = useMemo(() => cumXY(routeXY), [routeXY]);
  const routeLen = routeCum[routeCum.length - 1] ?? 0;
  const walkedM = scene.cum[scene.cum.length - 1] ?? 0;

  const { w, h } = size;
  const fit = useMemo<View>(() => fitView(routeXY, Math.max(w, 1), Math.max(h, 1), PAD), [routeXY, w, h]);
  const [view, setView] = useState<View>(fit);
  useEffect(() => setView(fit), [fit]);
  useEffect(() => setActiveStep(null), [path]);

  const minScale = fit.scale;
  const clampView = useCallback(
    (v: View): View => {
      const scale = Math.max(minScale, Math.min(MAX_SCALE, v.scale));
      // Keep at least part of the route in view.
      const hw = w / 2 / scale;
      const hh = h / 2 / scale;
      const xs = routeXY.map((p) => p[0]);
      const ys = routeXY.map((p) => p[1]);
      const clampTo = (c: number, lo: number, hi: number, half: number) => Math.max(lo - half, Math.min(hi + half, c));
      return {
        scale,
        cx: clampTo(v.cx, Math.min(...xs), Math.max(...xs), hw * 0.8),
        cy: clampTo(v.cy, Math.min(...ys), Math.max(...ys), hh * 0.8),
      };
    },
    [minScale, routeXY, w, h],
  );

  const sx = useCallback((x: number) => (x - view.cx) * view.scale + w / 2, [view, w]);
  const sy = useCallback((y: number) => (y - view.cy) * view.scale + h / 2, [view, h]);
  const inView = useCallback(
    (pts: readonly XY[], margin = 12) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        const x = sx(p[0]);
        const y = sy(p[1]);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      return maxX >= -margin && minX <= w + margin && maxY >= -margin && minY <= h + margin;
    },
    [sx, sy, w, h],
  );

  /* ---------- gestures (full mode): Pointer Events, touch-action none ---------- */
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ d: number; mx: number; my: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const zoomAbout = useCallback(
    (px: number, py: number, factor: number) =>
      setView((v) => {
        const scale = Math.max(minScale, Math.min(MAX_SCALE, v.scale * factor));
        const wx = (px - w / 2) / v.scale + v.cx;
        const wy = (py - h / 2) / v.scale + v.cy;
        return clampView({ scale, cx: wx - (px - w / 2) / scale, cy: wy - (py - h / 2) / scale });
      }),
    [minScale, w, h, clampView],
  );
  const panBy = useCallback((dx: number, dy: number) => setView((v) => clampView({ ...v, cx: v.cx - dx / v.scale, cy: v.cy - dy / v.scale })), [clampView]);

  const down = (e: ReactPointerEvent) => {
    if (!full || (e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, local(e));
    last.current = null;
  };
  const move = (e: ReactPointerEvent) => {
    if (!full || !ptrs.current.has(e.pointerId)) return;
    const prev = ptrs.current.get(e.pointerId)!;
    const now = local(e);
    ptrs.current.set(e.pointerId, now);
    const pts = [...ptrs.current.values()];
    if (pts.length === 1) {
      panBy(now.x - prev.x, now.y - prev.y);
    } else if (pts.length === 2) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const mx = (pts[0]!.x + pts[1]!.x) / 2;
      const my = (pts[0]!.y + pts[1]!.y) / 2;
      if (last.current && last.current.d > 0) {
        panBy(mx - last.current.mx, my - last.current.my);
        zoomAbout(mx, my, d / last.current.d);
      }
      last.current = { d, mx, my };
    }
  };
  const up = (e: ReactPointerEvent) => {
    ptrs.current.delete(e.pointerId);
    last.current = null;
  };

  useEffect(() => {
    const el = box.current;
    if (!el || !full) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAbout(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [full, zoomAbout]);

  const onKey = (e: KeyboardEvent) => {
    if (!full) return;
    const step = 60;
    const handled = {
      ArrowLeft: () => panBy(step, 0),
      ArrowRight: () => panBy(-step, 0),
      ArrowUp: () => panBy(0, step),
      ArrowDown: () => panBy(0, -step),
      "+": () => zoomAbout(w / 2, h / 2, 1.5),
      "=": () => zoomAbout(w / 2, h / 2, 1.5),
      "-": () => zoomAbout(w / 2, h / 2, 1 / 1.5),
      "0": () => setView(fit),
    }[e.key];
    if (handled) {
      e.preventDefault();
      handled();
    }
  };

  /* ---------- what to draw ---------- */
  const ready = w > 0 && h > 0;

  // Chevrons about every 110 px along the route.
  const chevrons = useMemo(() => {
    if (!ready || routeLen === 0) return [];
    const every = 110 / view.scale;
    const out: { x: number; y: number; a: number; both: boolean }[] = [];
    for (let d = every / 2; d < routeLen; d += every) {
      const p = atXY(routeXY, routeCum, d);
      let step = scene.route.stepStart.length - 1;
      while (step > 0 && routeCum[scene.route.stepStart[step]!]! > d) step--;
      out.push({ ...p, both: scene.bothWays[step] ?? false });
    }
    return out;
  }, [ready, routeLen, view.scale, routeXY, routeCum, scene]);

  // Step markers: one badge at the start of each Directions step. Badges that would sit on top of each other fan out.
  const markers = useMemo(() => {
    if (!ready) return [];
    const taken = new Map<string, number>();
    return scene.steps.map((s, i) => {
      const idx = s.at >= scene.route.stepStart.length ? scene.route.points.length - 1 : scene.route.stepStart[s.at]!;
      const [x, y] = routeXY[idx]!;
      const px = sx(x);
      const py = sy(y);
      const key = `${Math.round(px / 14)}:${Math.round(py / 14)}`;
      const n = taken.get(key) ?? 0;
      taken.set(key, n + 1);
      return { i, s, x: px + n * 20, y: py - n * 6 };
    });
  }, [ready, scene, routeXY, sx, sy]);

  const labels = useMemo(() => {
    if (!ready) return [];
    const cap = full ? 12 : 6;
    const placed: { x: number; y: number; hw: number; hh: number }[] = [];
    const out: { text: string; x: number; y: number; rot: number; route: boolean }[] = [];
    for (const l of scene.labels) {
      if (out.length >= cap) break;
      if (!full && !l.route) continue;
      const [mx, my] = project(l.pos);
      const x = sx(mx);
      const y = sy(my);
      if (x < 20 || x > w - 20 || y < 14 || y > h - 14) continue;
      const dx = l.angle[1] * Math.cos((l.pos[0] * Math.PI) / 180);
      const dy = -l.angle[0];
      let rot = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (rot > 90) rot -= 180;
      if (rot < -90) rot += 180;
      const tw = l.text.length * 6.1 + 6;
      const r = (rot * Math.PI) / 180;
      const hw = (Math.abs(Math.cos(r)) * tw + Math.abs(Math.sin(r)) * 13) / 2;
      const hh = (Math.abs(Math.sin(r)) * tw + Math.abs(Math.cos(r)) * 13) / 2;
      if (placed.some((p) => Math.abs(p.x - x) < p.hw + hw && Math.abs(p.y - y) < p.hh + hh)) continue;
      placed.push({ x, y, hw, hh });
      out.push({ text: l.text, x, y, rot, route: l.route });
    }
    return out;
  }, [ready, scene, full, sx, sy, w, h]);

  // The crossing badge sits to the side of the line, away from the rest of the route.
  const crossingBadge = useMemo(() => {
    if (!ready || !scene.crossing) return null;
    const [cx, cy] = project(scene.crossing);
    const near = routeXY.filter((p) => Math.hypot(p[0] - cx, p[1] - cy) > 40 / view.scale);
    const off = 34 / view.scale;
    const spots: XY[] = [[cx - off, cy - off], [cx + off, cy - off], [cx - off, cy + off], [cx + off, cy + off]];
    const clear = (s: XY) => Math.min(...near.map((p) => Math.hypot(p[0] - s[0], p[1] - s[1])), Infinity);
    const best = spots.reduce((a, b) => (clear(b) > clear(a) ? b : a));
    return { x: sx(best[0]), y: sy(best[1]), px: sx(cx), py: sy(cy) };
  }, [ready, scene, routeXY, view.scale, sx, sy]);

  const scrub = useMemo(() => {
    if (!ready || scrubM === null || walkedM === 0) return null;
    const p = atXY(routeXY, routeCum, (Math.max(0, Math.min(walkedM, scrubM)) / walkedM) * routeLen);
    return { x: sx(p.x), y: sy(p.y) };
  }, [ready, scrubM, walkedM, routeLen, routeXY, routeCum, sx, sy]);

  const barrierShown = ready && BARRIERS_XY.some((b) => inView(b.xy, 0));
  const barBar = niceScaleBarM(view.scale, full ? 120 : 90);
  const activeStep = active !== null ? scene.steps[active] : undefined;
  const approx = scene.approximate;

  const routeD = ready ? pathD(routeXY, sx, sy) : "";
  const useBasemap = full && basemap;

  return (
    <div
      ref={box}
      className={`map map-${mode}`}
      data-mood={mood}
      data-nodrag={full ? "" : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => {
        if (!full || (e.target as HTMLElement).closest("button")) return;
        const p = local(e);
        zoomAbout(p.x, p.y, 2);
      }}
      onKeyDown={onKey}
      tabIndex={full ? 0 : undefined}
      aria-roledescription={full ? "map" : undefined}
    >
      {useBasemap && <BasemapLayer scene={scene} onStep={(i) => setActiveStep(active === i ? null : i)} active={active} onFail={() => onBasemapFail?.()} />}
      {ready && (
        <svg className="map-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={scene.ariaLabel} style={useBasemap ? { visibility: "hidden" } : undefined}>
          <rect width={w} height={h} fill="var(--map-land)" />

          {/* legal network: faint context */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round">
            {NETWORK_XY.filter((n) => !n.crossing && inView(n.xy)).map((n) => (
              <path key={n.id} d={pathD(n.xy, sx, sy)} stroke="var(--map-street)" strokeWidth="1.5" strokeDasharray={n.approx ? "3 4" : undefined} />
            ))}
          </g>

          {/* the roads she will not walk: always drawn, dashed, never colour alone */}
          <g fill="none" strokeLinecap="butt">
            {BARRIERS_XY.map((b) => (
              <path key={b.id} d={pathD(b.xy, sx, sy)} stroke="var(--map-barrier)" strokeWidth="2.5" strokeDasharray="6 5" />
            ))}
          </g>
          {BARRIERS_XY.filter((b, i, all) => all.findIndex((o) => o.road === b.road && Math.hypot(o.xy[1]![0] - o.xy[0]![0], o.xy[1]![1] - o.xy[0]![1]) >= Math.hypot(b.xy[1]![0] - b.xy[0]![0], b.xy[1]![1] - b.xy[0]![1])) === i).map((b) => {
            const mx = (sx(b.xy[0]![0]) + sx(b.xy[1]![0])) / 2;
            const my = (sy(b.xy[0]![1]) + sy(b.xy[1]![1])) / 2;
            let rot = (Math.atan2(sy(b.xy[1]![1]) - sy(b.xy[0]![1]), sx(b.xy[1]![0]) - sx(b.xy[0]![0])) * 180) / Math.PI;
            if (rot > 90) rot -= 180;
            if (rot < -90) rot += 180;
            if (mx < 30 || mx > w - 30 || my < 20 || my > h - 20) return null;
            return (
              <text key={`bl-${b.id}`} className="map-label map-label-barrier" textAnchor="middle" transform={`translate(${mx.toFixed(1)} ${(my - 7).toFixed(1)}) rotate(${rot.toFixed(1)})`}>
                {"⊘ "}
                {b.label}
              </text>
            );
          })}

          {/* the route: casing, line, chevrons */}
          <path d={routeD} fill="none" stroke="var(--bg)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <path d={routeD} fill="none" stroke="var(--map-route)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={approx ? "9 5" : undefined} />
          {chevrons.map((c, i) => (
            <g key={i} transform={`translate(${sx(c.x).toFixed(1)} ${sy(c.y).toFixed(1)}) rotate(${((c.a * 180) / Math.PI).toFixed(1)})`} aria-hidden="true">
              <circle r={c.both ? 10 : 7.5} fill="var(--map-route)" />
              {c.both ? (
                <>
                  <path d="M-1 -3.5 L2.5 0 L-1 3.5" fill="none" stroke="var(--on-forest)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" transform="translate(2 0)" />
                  <path d="M1 -3.5 L-2.5 0 L1 3.5" fill="none" stroke="var(--on-forest)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" transform="translate(-2 0)" />
                </>
              ) : (
                <path d="M-2.5 -3.5 L2.5 0 L-2.5 3.5" fill="none" stroke="var(--on-forest)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </g>
          ))}

          {/* Home, turnarounds, places */}
          {scene.turnarounds.map((id) => {
            const [x, y] = project([nodes[id]!.lat, nodes[id]!.lon]);
            return <circle key={`t-${id}`} cx={sx(x)} cy={sy(y)} r="9" fill="none" stroke="var(--ink)" strokeWidth="1.75" />;
          })}
          {scene.places.map((id) => {
            const [x, y] = project([nodes[id]!.lat, nodes[id]!.lon]);
            return <rect key={`p-${id}`} x={sx(x) - 5} y={sy(y) - 5} width="10" height="10" transform={`rotate(45 ${sx(x)} ${sy(y)})`} fill="var(--sun)" stroke="var(--ink)" strokeWidth="1.5" />;
          })}
          <circle cx={sx(0)} cy={sy(0)} r="9" fill="var(--bg)" stroke="var(--ink)" strokeWidth="1.5" />
          <circle cx={sx(0)} cy={sy(0)} r="5.5" fill="var(--ink)" />

          {/* street labels */}
          {labels.map((l, i) => (
            <text key={i} className={`map-label${l.route ? " map-label-route" : ""}`} textAnchor="middle" dominantBaseline="central" transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)}) rotate(${l.rot.toFixed(1)})`}>
              {l.text}
            </text>
          ))}

          {/* the crossing: a small leader to its badge */}
          {crossingBadge && <line x1={crossingBadge.px} y1={crossingBadge.py} x2={crossingBadge.x} y2={crossingBadge.y} stroke="var(--map-barrier)" strokeWidth="1.5" />}
          {crossingBadge && <circle cx={crossingBadge.px} cy={crossingBadge.py} r="4" fill="var(--bg)" stroke="var(--map-barrier)" strokeWidth="2" />}

          {scrub && (
            <g>
              <circle cx={scrub.x} cy={scrub.y} r="9" fill="var(--sun)" fillOpacity="0.35" />
              <circle cx={scrub.x} cy={scrub.y} r="5" fill="var(--sun)" stroke="var(--ink)" strokeWidth="1.75" />
            </g>
          )}

          {/* scale bar, north arrow */}
          <g transform={`translate(12 ${h - 14})`} aria-hidden="true">
            <path d={`M0 -5 V0 H${(barBar * view.scale).toFixed(1)} V-5`} fill="none" stroke="var(--ink)" strokeWidth="1.75" />
            <text x="0" y="-9" className="map-label map-label-plain">
              {barBar >= 1000 ? `${barBar / 1000} km` : `${barBar} m`}
            </text>
          </g>
          <g transform={`translate(${w - (full ? 28 : 60)} 26)`} aria-hidden="true">
            <path d="M0 -14 L7 8 L0 3 L-7 8 Z" fill="var(--ink)" />
            <text y="21" textAnchor="middle" className="map-label map-label-plain">N</text>
          </g>
        </svg>
      )}

      {/* HTML overlays: real buttons for steps in full mode */}
      {ready && !useBasemap && (
        <div className="map-overlay">
          {markers.map(({ i, s, x, y }) =>
            full ? (
              <button
                key={i}
                type="button"
                className="map-step pressable"
                data-active={active === i}
                style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
                aria-pressed={active === i}
                aria-label={`Step ${i + 1}: ${s.kind === "street" ? `${s.turn} ${s.street}` : s.street}`}
                onClick={() => setActiveStep(active === i ? null : i)}
              >
                {i + 1}
              </button>
            ) : (
              <span key={i} className="map-step" data-active={active === i} aria-hidden="true" style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}>
                {i + 1}
              </span>
            ),
          )}
          {crossingBadge && (
            <div className="map-crossing" style={{ transform: `translate(${crossingBadge.x}px, ${crossingBadge.y}px) translate(-50%, -50%)` }}>
              <span className="map-crossing-badge" aria-hidden="true">
                <Caution size={16} />
              </span>
              <span className="map-crossing-label">{MAP_COPY.crossing}</span>
            </div>
          )}
        </div>
      )}

      {/* chrome */}
      {ready && approx && <span className="map-chip">{MAP_COPY.approximate}</span>}
      {ready && barrierShown && (
        <span className="map-legend">
          <svg width="26" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="26" y2="4" stroke="var(--map-barrier)" strokeWidth="2.5" strokeDasharray="6 5" />
          </svg>
          {MAP_COPY.notWalked}
        </span>
      )}
      <span className="map-attrib">{MAP_ATTRIBUTION}</span>
      {!full && onExpand && (
        <button type="button" className="map-expand pressable" onClick={onExpand}>
          Expand
        </button>
      )}
      {full && ready && (
        <div className="map-zoom" data-nodrag>
          <button type="button" className="map-ctl pressable" onClick={() => zoomAbout(w / 2, h / 2, 1.5)} aria-label="Zoom in">+</button>
          <button type="button" className="map-ctl pressable" onClick={() => zoomAbout(w / 2, h / 2, 1 / 1.5)} aria-label="Zoom out">−</button>
          <button type="button" className="map-ctl pressable" onClick={() => setView(fit)} aria-label="Recenter">⌖</button>
        </div>
      )}
      {full && activeStep && (
        <p className="map-step-note" aria-live="polite">
          <strong>{(active ?? 0) + 1}.</strong> {activeStep.kind === "street" ? `${activeStep.turn} ${activeStep.street}` : activeStep.street}
        </p>
      )}
    </div>
  );
}
