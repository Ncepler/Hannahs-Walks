"use client";

import { useEffect, useRef } from "react";
import { BASEMAP_ATTRIBUTION } from "@/lib/config";
import { BARRIERS, NETWORK, type MapScene } from "@/lib/mapScene";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** MapLibre needs WebGL; without it the toggle is hidden and the self-drawn map stays. */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const lonlat = (p: readonly [number, number]): [number, number] => [p[1], p[0]];
const line = (pts: readonly (readonly [number, number])[], props: Record<string, unknown> = {}) => ({
  type: "Feature" as const,
  properties: props,
  geometry: { type: "LineString" as const, coordinates: pts.map(lonlat) },
});
const collection = (features: ReturnType<typeof line>[]) => ({ type: "FeatureCollection" as const, features });

const css = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/**
 * The optional street background (ROADS-ADDENDUM §7.6). The legal network, the roads she will not use and the route are
 * MapLibre line layers built from the same decoded geometry and the same colours as the self-drawn map. Loaded only
 * when switched on; nothing here runs otherwise.
 */
export default function BasemapLayer({
  scene,
  active,
  onStep,
  onFail,
}: {
  scene: MapScene;
  active: number | null;
  onStep: (i: number) => void;
  onFail: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const markers = useRef<{ el: HTMLButtonElement; i: number }[]>([]);
  const fail = useRef(onFail);
  fail.current = onFail;
  const step = useRef(onStep);
  step.current = onStep;

  useEffect(() => {
    let map: import("maplibre-gl").Map | undefined;
    let gone = false;
    (async () => {
      try {
        if (!webglAvailable()) throw new Error("no webgl");
        const maplibregl = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");
        if (gone || !host.current) return;
        const pts = scene.route.points;
        const lons = pts.map((p) => p[1]);
        const lats = pts.map((p) => p[0]);
        const m = new maplibregl.Map({
          container: host.current,
          style: STYLE_URL,
          bounds: [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          fitBoundsOptions: { padding: 40 },
          attributionControl: false,
          pitchWithRotate: false,
          dragRotate: false,
        });
        map = m;
        m.touchZoomRotate.disableRotation();
        m.on("error", () => {
          // A style or tile failure leaves a blank map; say nothing, hand back to the self-drawn one.
          if (!m.isStyleLoaded() && !gone) fail.current();
        });
        m.on("load", () => {
          const street = css("--map-street", "rgba(22,36,28,.3)");
          const barrier = css("--map-barrier", "#BF5B3A");
          const route = css("--map-route", "#2C5A44");
          m.addSource("network", { type: "geojson", data: collection(NETWORK.filter((n) => !n.crossing).map((n) => line(n.pts))) });
          m.addSource("barriers", { type: "geojson", data: collection(BARRIERS.map((b) => line(b.pts, { label: b.label }))) });
          m.addSource("route", { type: "geojson", data: collection([line(pts)]) });
          m.addLayer({ id: "network", type: "line", source: "network", paint: { "line-color": street, "line-width": 1.5 }, layout: { "line-cap": "round" } });
          m.addLayer({ id: "barriers", type: "line", source: "barriers", paint: { "line-color": barrier, "line-width": 2.5, "line-dasharray": [2.4, 2] } });
          m.addLayer({ id: "barrier-labels", type: "symbol", source: "barriers", layout: { "symbol-placement": "line", "text-field": ["concat", "⊘ ", ["get", "label"]], "text-size": 11 }, paint: { "text-color": barrier, "text-halo-color": "#fff", "text-halo-width": 1.5 } });
          m.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": css("--bg", "#F5F2EA"), "line-width": 8 }, layout: { "line-cap": "round", "line-join": "round" } });
          m.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": route, "line-width": 4.5, ...(scene.approximate ? { "line-dasharray": [2, 1.1] } : {}) }, layout: { "line-cap": "round", "line-join": "round" } });

          markers.current = scene.steps.map((s, i) => {
            const idx = s.at >= scene.route.stepStart.length ? pts.length - 1 : scene.route.stepStart[s.at]!;
            const el = document.createElement("button");
            el.type = "button";
            el.className = "map-step pressable";
            el.textContent = String(i + 1);
            el.setAttribute("aria-label", `Step ${i + 1}: ${s.kind === "street" ? `${s.turn} ${s.street}` : s.street}`);
            el.addEventListener("click", () => step.current(i));
            new maplibregl.Marker({ element: el }).setLngLat(lonlat(pts[idx]!)).addTo(m);
            return { el, i };
          });
          if (scene.crossing) {
            const el = document.createElement("span");
            el.className = "map-crossing";
            el.innerHTML = '<span class="map-crossing-badge" aria-hidden="true">!</span><span class="map-crossing-label"></span>';
            el.querySelector(".map-crossing-label")!.textContent = "Cross at the signal · wait about a minute";
            new maplibregl.Marker({ element: el }).setLngLat(lonlat(scene.crossing)).addTo(m);
          }
          m.addControl(new maplibregl.AttributionControl({ customAttribution: BASEMAP_ATTRIBUTION, compact: false }));
        });
      } catch {
        if (!gone) fail.current();
      }
    })();
    return () => {
      gone = true;
      map?.remove();
    };
  }, [scene]);

  useEffect(() => {
    for (const m of markers.current) m.el.dataset.active = String(m.i === active);
  }, [active]);

  return <div ref={host} className="map-basemap" />;
}
