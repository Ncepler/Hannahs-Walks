"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { COPY, DEFAULT_BASEMAP, MAP_COPY } from "@/lib/config";
import { MAPS_MAX_WAYPOINTS_MOBILE, mapsMaxWaypoints } from "@/lib/mapsLimits";
import { fmtClimb, fmtMiles, fmtTime, hasBusyRoad, pausePoints, whyThisOne } from "@/lib/describe";
import { embedUrl, mapsLink, selectWaypoints } from "@/lib/maps";
import { minutesFor, type PoolRoute } from "@/lib/score";
import type { Mood, Pace } from "@/lib/types";
import { CheckRow } from "./CheckRow";
import { vars } from "./css";
import { ElevationProfile } from "./ElevationProfile";
import { Caution, MoodIcon } from "./icons";
import { MapEmbed } from "./MapEmbed";
import { RouteMap } from "./RouteMap";
import { Sheet } from "./Sheet";
import { webglAvailable } from "./BasemapLayer";
import { useStaged } from "./useStaged";

interface Props {
  route: PoolRoute;
  mood: Mood;
  pace: Pace;
  /** One line saying what was loosened, if anything. */
  note?: string | null;
  onAnother: () => void;
  onChange: () => void;
  onDirections: () => void;
  /** "Start from Home" adds an origin to the Maps link; otherwise Google starts where she stands. */
  startFromHome: boolean;
  onStartFromHome: (v: boolean) => void;
  /** Premium: the planner's own words replace the generated "why", and the buttons change. */
  premium?: { why: string; caveat?: string | null };
}

/** The result: route card and sketch. Reveals with a stagger; swaps with a quick fade. */
export function RouteCard({ route: incoming, mood, pace, note, onAnother, onChange, onDirections, startFromHome, onStartFromHome, premium }: Props) {
  const { shown: route, phase } = useStaged(incoming, 140, true);
  const title = useRef<HTMLHeadingElement>(null);

  // First reveal: put focus on the name so the result is announced and reachable.
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);

  const pauses = pausePoints(route);
  const [scrubM, setScrubM] = useState<number | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP);
  const [canBasemap, setCanBasemap] = useState(false);
  useEffect(() => {
    setCanBasemap(webglAvailable());
    try {
      if (localStorage.getItem("sw_basemap") === "1") setBasemap(true);
    } catch {
      /* storage can be blocked */
    }
  }, []);
  const chooseBasemap = (on: boolean) => {
    setBasemap(on);
    try {
      localStorage.setItem("sw_basemap", on ? "1" : "0");
    } catch {
      /* storage can be blocked */
    }
  };
  const [limit, setLimit] = useState(MAPS_MAX_WAYPOINTS_MOBILE);
  useEffect(() => setLimit(mapsMaxWaypoints(navigator.userAgent, navigator.maxTouchPoints)), []);
  const plan = useMemo(() => selectWaypoints(route.path, limit), [route.path, limit]);
  const embed = embedUrl(route.path, plan.waypoints);
  const openMaps = () => {
    // The limit is read when the button is pressed, not at render.
    const now = selectWaypoints(route.path, mapsMaxWaypoints(navigator.userAgent, navigator.maxTouchPoints));
    window.open(mapsLink(route.path, now.waypoints, { startFromHome }), "_blank", "noopener,noreferrer");
  };
  const stagger = (i: number) => vars({ "--i": i });

  return (
    <div className="result" data-phase={phase}>
      <article className="card route-card" aria-labelledby="route-name">
        <div className="rc chips-row" style={stagger(0)}>
          <span className="tag mood-tag" data-mood={mood}>
            <MoodIcon mood={mood} size={18} />
            {COPY.moods[mood].label}
          </span>
          {route.tags && <span className="tag">{route.tags}</span>}
        </div>

        <h2 id="route-name" className="rc route-name" tabIndex={-1} ref={title} aria-live="polite" style={stagger(1)}>
          {route.name}
        </h2>

        <div className="rc" style={stagger(2)}>
          {route.blurb && <p className="blurb">{route.blurb}</p>}
          {premium && <blockquote className="quote">{premium.why}</blockquote>}
          {premium?.caveat && <p className="relaxed">{premium.caveat}</p>}
          {note && <p className="relaxed">{note}</p>}
        </div>

        <dl className="rc stats" style={stagger(3)}>
          <div>
            <dt className="eyebrow">Distance</dt>
            <dd>{fmtMiles(route.stats.miles)}</dd>
          </div>
          <div>
            <dt className="eyebrow">Time</dt>
            <dd>{fmtTime(minutesFor(route.stats, pace))}</dd>
          </div>
          <div>
            <dt className="eyebrow">Climb</dt>
            <dd>{fmtClimb(route.stats.ascentFt)}</dd>
          </div>
        </dl>
        {route.stats.crossings > 0 && (
          <p className="note rc" style={stagger(3)}>
            <Caution />
            <span>{COPY.crossingChip}</span>
          </p>
        )}

        <div className="rc" style={stagger(4)}>
          <ElevationProfile path={route.path} mood={mood} scrubM={scrubM} onScrub={setScrubM} />
        </div>

        <div className="rc details" style={stagger(5)}>
          {!premium && (
            <p className="why">
              <span className="eyebrow">Why this one</span>
              {whyThisOne(route, mood)}
            </p>
          )}
          {pauses.length > 0 && (
            <ul className="pauses">
              {pauses.map((p) => (
                <li key={p.id}>
                  <span className="diamond" aria-hidden="true" />
                  <span>
                    <strong>{p.title}</strong> — {p.text}
                    {p.hours && <span className="muted"> {COPY.hoursNote}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hasBusyRoad(route) && (
            <p className="note">
              <Caution />
              <span>{COPY.busyNote}</span>
            </p>
          )}
        </div>

        <div className="rc actions" style={stagger(6)}>
          <button type="button" className="btn btn-primary pressable" onClick={openMaps}>
            {COPY.actions.maps}
          </button>
          <button type="button" className="btn btn-secondary pressable" onClick={onDirections}>
            {COPY.actions.directions}
          </button>
          <div className="actions-wide">
            <CheckRow checked={startFromHome} onChange={onStartFromHome} label="Start from Home" />
            {plan.risky ? (
              <p className="relaxed">{COPY.mapsRisky}</p>
            ) : (
              !plan.exact && <p className="relaxed">{COPY.mapsMismatch}</p>
            )}
          </div>
          <button type="button" className="btn btn-secondary pressable" onClick={onAnother}>
            {premium ? "Try again" : COPY.actions.another}
          </button>
          <button type="button" className="btn btn-text pressable" onClick={onChange}>
            {premium ? "Edit my note" : COPY.actions.change}
          </button>
        </div>

        <p className="rc fineprint" style={stagger(7)}>
          {COPY.footer}
        </p>
      </article>

      <aside className="card map-card" aria-label="Route map">
        <RouteMap path={route.path} mood={mood} mode="preview" onExpand={() => setMapOpen(true)} scrubM={scrubM} />
      </aside>

      {embed && <MapEmbed src={embed} />}

      {mapOpen && (
        <Sheet labelledBy="map-title" onClose={() => setMapOpen(false)}>
          {(api) => (
            <>
              <div className="dir-head" data-drag>
                <div className="dir-head-row">
                  <h2 id="map-title" className="dir-title">
                    {route.name}
                  </h2>
                  <button type="button" className="icon-btn pressable" data-nodrag onClick={api.close} aria-label="Close map">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="map-full">
                <RouteMap path={route.path} mood={mood} mode="full" scrubM={scrubM} basemap={basemap && canBasemap} onBasemapFail={() => { setCanBasemap(false); }} />
              </div>
              {canBasemap && (
                <div className="map-toggle" data-nodrag>
                  <CheckRow checked={basemap} onChange={chooseBasemap} label={MAP_COPY.basemapToggle} sub={MAP_COPY.basemapHelp} />
                </div>
              )}
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
