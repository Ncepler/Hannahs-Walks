"use client";

import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { COPY } from "@/lib/config";
import { buildDirections, fmtCumulative, fmtStepDistance, stepsToText } from "@/lib/directions";
import { fmtMiles, fmtTime } from "@/lib/describe";
import { mapsLink, type WaypointPlan } from "@/lib/maps";
import { minutesFor, type PoolRoute } from "@/lib/score";
import type { Pace } from "@/lib/types";
import { Caution } from "./icons";
import type { SheetApi } from "./Sheet";

/** Copies text; falls back to a hidden textarea where the async clipboard is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;opacity:0;font-size:16px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** The route outline, street by street (§11). Follows along by hand: no location, no tracking. */
export function Directions({
  route,
  pace,
  plan,
  startFromHome,
  api,
}: {
  route: PoolRoute;
  pace: Pace;
  plan: WaypointPlan;
  startFromHome: boolean;
  api: SheetApi;
}) {
  const steps = useMemo(() => buildDirections(route.path), [route.path]);
  const summary = `${fmtMiles(route.stats.miles)} · ${fmtTime(minutesFor(route.stats, pace))}`;
  const [here, setHere] = useState<number | null>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const list = useRef<HTMLOListElement>(null);
  const timer = useRef(0);

  const mark = (i: number) => {
    const next = here === i ? null : i;
    setHere(next);
    if (next === null) return;
    // Bring this step to the top so the next couple are in view too.
    requestAnimationFrame(() => {
      const box = list.current?.parentElement;
      const row = list.current?.children[next] as HTMLElement | undefined;
      if (!box || !row) return;
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      box.scrollTo({ top: Math.max(0, row.offsetTop - 8), behavior: smooth ? "smooth" : "auto" });
    });
  };

  const copy = async () => {
    const ok = await copyText(stepsToText(route.name, summary, steps));
    setCopied(ok ? "done" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied("idle"), 1800);
  };

  const openMaps = () => window.open(mapsLink(route.path, plan.waypoints, { startFromHome }), "_blank", "noopener,noreferrer");

  return (
    <>
      <header className="dir-head" data-drag>
        <div className="dir-head-row">
          <h2 id="dir-title" className="dir-title">
            {route.name}
          </h2>
          <button type="button" className="icon-btn pressable" data-nodrag onClick={api.close} aria-label="Close directions">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <p className="dir-meta">{summary}</p>
        <p className="dir-explain">{COPY.directionsHeader}</p>
        {!plan.exact && <p className="dir-explain">{COPY.mapsMismatch}</p>}
      </header>

      <div className="dir-scroll" data-scroll>
        <ol className="dir-list" ref={list}>
          {steps.map((s, i) => (
            <li key={i}>
              <button type="button" className="dir-step" aria-pressed={here === i} onClick={() => mark(i)}>
                <span className="dir-badge" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="dir-main">
                  <span className="dir-line">
                    {s.kind === "street" && <span className="dir-turn">{s.turn} </span>}
                    <strong>{s.street}</strong>
                  </span>
                  {s.cue && <span className="dir-cue">{s.cue}</span>}
                  {s.notes.map((n) => (
                    <span key={n.text} className="dir-note">
                      {n.caution && <Caution size={16} />}
                      <span>{n.text}</span>
                    </span>
                  ))}
                  {here === i ? <span className="dir-here">You are here</span> : <span className="sr-only">Tap to mark where you are</span>}
                </span>
                {s.kind === "street" && (
                  <span className="dir-dist">
                    <span>{fmtStepDistance(s.meters)}</span>
                    <span className="muted">{fmtCumulative(s.cumMeters)}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <motion.footer className="dir-foot" data-nodrag style={api.lift ? { transform: api.lift } : undefined}>
        <button type="button" className="btn btn-primary pressable grow" onClick={openMaps}>
          {COPY.actions.maps}
        </button>
        <button type="button" className="btn btn-secondary pressable" onClick={copy}>
          {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy steps"}
        </button>
        <button type="button" className="btn btn-text pressable" onClick={api.close}>
          Close
        </button>
        <span className="sr-only" aria-live="polite">
          {copied === "done" ? "Steps copied" : copied === "failed" ? "Could not copy" : ""}
        </span>
      </motion.footer>
    </>
  );
}
