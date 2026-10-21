"use client";

import { useEffect, useRef } from "react";
import { COPY } from "@/lib/config";
import { fmtClimb, fmtMiles, fmtTime, hasBusyRoad, pausePoints, whyThisOne } from "@/lib/describe";
import { minutesFor, type PoolRoute } from "@/lib/score";
import type { Mood, Pace } from "@/lib/types";
import { vars } from "./css";
import { ElevationProfile } from "./ElevationProfile";
import { Caution, MoodIcon } from "./icons";
import { RouteSketch } from "./RouteSketch";
import { useStaged } from "./useStaged";

interface Props {
  route: PoolRoute;
  mood: Mood;
  pace: Pace;
  /** One line saying what was loosened, if anything. */
  note?: string | null;
  onAnother: () => void;
  onChange: () => void;
  onDirections?: () => void;
  onMaps?: () => void;
}

/** The result: route card and sketch. Reveals with a stagger; swaps with a quick fade. */
export function RouteCard({ route: incoming, mood, pace, note, onAnother, onChange, onDirections, onMaps }: Props) {
  const { shown: route, phase } = useStaged(incoming, 140, true);
  const title = useRef<HTMLHeadingElement>(null);

  // First reveal: put focus on the name so the result is announced and reachable.
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);

  const pauses = pausePoints(route);
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

        <div className="rc" style={stagger(4)}>
          <ElevationProfile path={route.path} mood={mood} />
        </div>

        <div className="rc details" style={stagger(5)}>
          <p className="why">
            <span className="eyebrow">Why this one</span>
            {whyThisOne(route, mood)}
          </p>
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
          <button type="button" className="btn btn-primary pressable" onClick={onMaps} disabled={!onMaps}>
            {COPY.actions.maps}
          </button>
          <button type="button" className="btn btn-secondary pressable" onClick={onDirections} disabled={!onDirections}>
            {COPY.actions.directions}
          </button>
          <button type="button" className="btn btn-secondary pressable" onClick={onAnother}>
            {COPY.actions.another}
          </button>
          <button type="button" className="btn btn-text pressable" onClick={onChange}>
            {COPY.actions.change}
          </button>
        </div>

        <p className="rc fineprint" style={stagger(7)}>
          {COPY.footer}
        </p>
      </article>

      <aside className="card sketch-card" aria-label="Route sketch">
        <RouteSketch path={route.path} mood={mood} />
      </aside>
    </div>
  );
}
