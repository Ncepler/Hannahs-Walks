"use client";

import { useEffect, useRef } from "react";
import { COPY } from "@/lib/config";
import {
  defaultAnswers,
  type Answers,
  type DistanceBand,
  type Hills,
  type Stop,
  type TimeChoice,
} from "@/lib/score";
import type { Mood, Pace } from "@/lib/types";
import { CheckRow } from "./CheckRow";
import { vars } from "./css";
import { ChevronLeft, MoodIcon } from "./icons";
import { useStaged } from "./useStaged";

/* ---------- Form model ---------- */

export type TimeKey = "15" | "30" | "45" | "60" | "90" | "120+" | "none";
export type DistKey = DistanceBand | "fit";

/** What the buttons say. `null` means the question has not been answered. */
export interface Form {
  mood: Mood | null;
  time: TimeKey | null;
  distance: DistKey | null;
  hills: Hills | null;
  stops: Stop[];
  avoidBusy: boolean | null;
  /** "End back at Home". `null` means untouched, which is checked. */
  returnHome: boolean | null;
  pace: Pace | null;
}

export const emptyForm: Form = { mood: null, time: null, distance: null, hills: null, stops: [], avoidBusy: null, returnHome: null, pace: null };

const TIME_CHOICE: Record<TimeKey, TimeChoice | null> = {
  "15": { min: 15 },
  "30": { min: 30 },
  "45": { min: 45 },
  "60": { min: 60 },
  "90": { min: 90 },
  "120+": { min: 120, orMore: true },
  none: null,
};

/** Unanswered questions fall back to the §9.5 defaults. */
export function toAnswers(f: Form, mood: Mood): Answers {
  const d = defaultAnswers(mood);
  return {
    mood,
    time: f.time ? TIME_CHOICE[f.time] : null,
    distance: f.distance && f.distance !== "fit" ? f.distance : null,
    hills: f.hills ?? "any",
    stops: new Set(f.stops),
    avoidBusy: f.avoidBusy ?? d.avoidBusy,
    returnHome: f.returnHome ?? d.returnHome,
    pace: f.pace ?? d.pace,
  };
}

/* ---------- Options (§10.1) ---------- */

interface Opt<T extends string> {
  value: T;
  label: string;
  aria?: string;
}

const TIME_OPTS: Opt<TimeKey>[] = [
  { value: "15", label: "15 min", aria: "15 minutes" },
  { value: "30", label: "30", aria: "30 minutes" },
  { value: "45", label: "45", aria: "45 minutes" },
  { value: "60", label: "1 hr", aria: "1 hour" },
  { value: "90", label: "1½ hr", aria: "1 and a half hours" },
  { value: "120+", label: "2 hr +", aria: "2 hours or more" },
  { value: "none", label: "No limit" },
];
const DIST_OPTS: Opt<DistKey>[] = [
  { value: "<1", label: "Under 1 mi", aria: "Under 1 mile" },
  { value: "1-2", label: "1 – 2", aria: "1 to 2 miles" },
  { value: "2-3", label: "2 – 3", aria: "2 to 3 miles" },
  { value: "3-5", label: "3 – 5", aria: "3 to 5 miles" },
  { value: "5+", label: "5 +", aria: "5 miles or more" },
  { value: "fit", label: "Whatever fits my time" },
];
const HILL_OPTS: Opt<Hills>[] = [
  { value: "flat", label: "Flat please" },
  { value: "rolling", label: "Some rolling" },
  { value: "hilly", label: "Bring on the hills" },
  { value: "any", label: "Don't care" },
];
const STOP_OPTS: Opt<Stop>[] = [
  { value: "village", label: "Roslyn village" },
  { value: "pond", label: "The pond" },
  { value: "museum", label: "Museum grounds" },
  { value: "cedarmere", label: "Cedarmere" },
  { value: "library", label: "The library" },
  { value: "ridge", label: "The ridge" },
];
const PACE_OPTS: Opt<Pace>[] = [
  { value: "easy", label: "Easy" },
  { value: "steady", label: "Steady" },
  { value: "brisk", label: "Brisk" },
];
const MOODS: Mood[] = ["clear", "workout", "ponder"];

const TITLES = [
  "What kind of walk?",
  "How long do you have?",
  "How far?",
  "How hilly?",
  "Anything along the way?",
  "How's your pace?",
];
export const STEP_COUNT = TITLES.length;

const labelOf = <T extends string>(opts: Opt<T>[], v: T | null) => opts.find((o) => o.value === v);

/** Rows for the live summary; unanswered questions are left out. */
export function summaryRows(f: Form): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (f.mood) rows.push({ label: "Walk", value: COPY.moods[f.mood].label });
  const t = labelOf(TIME_OPTS, f.time);
  if (t) rows.push({ label: "Time", value: t.aria ?? t.label });
  const d = labelOf(DIST_OPTS, f.distance);
  if (d) rows.push({ label: "Distance", value: d.aria ?? d.label });
  const h = labelOf(HILL_OPTS, f.hills);
  if (h) rows.push({ label: "Hills", value: h.label });
  if (f.stops.length) rows.push({ label: "Along the way", value: f.stops.map((s) => labelOf(STOP_OPTS, s)!.label).join(", ") });
  if (f.mood) {
    const pace = f.pace ?? defaultAnswers(f.mood).pace;
    rows.push({ label: "Pace", value: labelOf(PACE_OPTS, pace)!.label });
    const busy = f.avoidBusy ?? f.mood === "clear";
    if (busy) rows.push({ label: "Roads", value: "Keeping off busy roads" });
    rows.push({ label: "Finish", value: (f.returnHome ?? true) ? "Back at Home" : "Anywhere, one-way walks included" });
  }
  return rows;
}

/* ---------- Pieces ---------- */

function Chips<T extends string>({
  label,
  opts,
  value,
  onPick,
}: {
  label: string;
  opts: Opt<T>[];
  value: T | null;
  onPick: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="opts">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          className="chip pressable"
          aria-pressed={value === o.value}
          aria-label={o.aria}
          onClick={() => onPick(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface Props {
  step: number;
  form: Form;
  onForm: (patch: Partial<Form>) => void;
  onStep: (n: number) => void;
  onPlan: () => void;
  onSurprise: () => void;
}

export function Wizard({ step, form, onForm, onStep, onPlan, onSurprise }: Props) {
  const { shown, phase } = useStaged(step, 140);
  const dir = useRef(1);
  if (step !== shown) dir.current = step > shown ? 1 : -1;

  const timer = useRef(0);
  const latest = useRef({ step, onStep, onPlan });
  useEffect(() => {
    latest.current = { step, onStep, onPlan };
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Move focus to the new question so keyboard and screen-reader users land on it.
  const title = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    title.current?.focus({ preventScroll: true });
  }, [shown]);

  /** Single-select: record the answer, then move on 180 ms later. */
  const pick = (patch: Partial<Form>) => {
    onForm(patch);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const l = latest.current;
      if (l.step < STEP_COUNT - 1) l.onStep(l.step + 1);
      else l.onPlan();
    }, 180);
  };
  const go = (n: number) => {
    window.clearTimeout(timer.current);
    onStep(n);
  };

  const mood = form.mood;
  const pace = form.pace ?? (mood ? defaultAnswers(mood).pace : null);
  const avoidBusy = form.avoidBusy ?? mood === "clear";
  const returnHome = form.returnHome ?? true;
  const last = step === STEP_COUNT - 1;

  return (
    <section className="wizard" aria-labelledby="q-title">
      <nav className="wizard-nav" aria-label="Progress">
        <button
          type="button"
          className="back-btn pressable"
          onClick={() => go(step - 1)}
          disabled={step === 0}
          aria-label="Back"
        >
          <ChevronLeft />
        </button>
        <ol className="dots">
          {TITLES.map((_, i) => (
            <li key={i} aria-current={i === step ? "step" : undefined}>
              <span className="dot" data-active={i === step} data-done={i < step} />
              <span className="sr-only">{`Step ${i + 1} of ${STEP_COUNT}`}</span>
            </li>
          ))}
        </ol>
        <span className="step-count" aria-hidden="true">{`${step + 1} of ${STEP_COUNT}`}</span>
      </nav>

      <div className="stage" data-phase={phase} style={vars({ "--dir": dir.current })}>
        <h2 id="q-title" className="q-title" tabIndex={-1} ref={title}>
          {TITLES[shown]}
        </h2>

        {shown === 0 && (
          <div role="group" aria-labelledby="q-title" className="mood-cards">
            {MOODS.map((m) => (
              <button
                key={m}
                type="button"
                className="mood-card pressable"
                data-mood={m}
                aria-pressed={form.mood === m}
                onClick={() => pick({ mood: m })}
              >
                <span className="mood-icon">
                  <MoodIcon mood={m} size={28} />
                </span>
                <span className="mood-text">
                  <span className="mood-label">{COPY.moods[m].label}</span>
                  <span className="mood-sub">{COPY.moods[m].sub}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {shown === 1 && <Chips label="Time" opts={TIME_OPTS} value={form.time} onPick={(v) => pick({ time: v })} />}
        {shown === 2 && <Chips label="Distance" opts={DIST_OPTS} value={form.distance ?? "fit"} onPick={(v) => pick({ distance: v })} />}
        {shown === 3 && <Chips label="Hills" opts={HILL_OPTS} value={form.hills} onPick={(v) => pick({ hills: v })} />}
        {shown === 4 && (
          <>
            <div role="group" aria-label="Along the way" className="opts">
              {STOP_OPTS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="chip pressable"
                  aria-pressed={form.stops.includes(o.value)}
                  onClick={() =>
                    onForm({ stops: form.stops.includes(o.value) ? form.stops.filter((s) => s !== o.value) : [...form.stops, o.value] })
                  }
                >
                  {o.label}
                </button>
              ))}
              <button
                type="button"
                className="chip pressable"
                aria-pressed={form.stops.length === 0}
                onClick={() => onForm({ stops: [] })}
              >
                Nothing in particular
              </button>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={avoidBusy}
              className="switch-row pressable"
              onClick={() => onForm({ avoidBusy: !avoidBusy })}
            >
              <span className="switch-label">Keep me off busy roads</span>
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
            </button>
            <CheckRow
              checked={returnHome}
              onChange={(v) => onForm({ returnHome: v })}
              label="End back at Home"
              sub="Uncheck it if you don’t need to walk home."
            />
          </>
        )}
        {shown === 5 && <Chips label="Pace" opts={PACE_OPTS} value={pace} onPick={(v) => pick({ pace: v })} />}
      </div>

      <div className="bar">
        {step === 0 ? (
          <button type="button" className="btn btn-secondary pressable grow" onClick={onSurprise}>
            {COPY.surprise}
          </button>
        ) : (
          <>
            {!last && (
              <button type="button" className="btn btn-text pressable" onClick={() => go(step + 1)}>
                Skip
              </button>
            )}
            <span className="bar-gap" />
            {!last && (
              <button type="button" className="btn btn-secondary pressable" onClick={onPlan}>
                {COPY.planNow}
              </button>
            )}
            {step === 4 && (
              <button type="button" className="btn btn-primary pressable" onClick={() => go(step + 1)}>
                Next
              </button>
            )}
            {last && (
              <button type="button" className="btn btn-primary pressable grow" onClick={onPlan}>
                {COPY.plan}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function Summary({ form }: { form: Form }) {
  const rows = summaryRows(form);
  return (
    <section className="card summary" aria-label="Your answers">
      <h2 className="card-title">Your answers</h2>
      {rows.length ? (
        <dl className="summary-list">
          {rows.map((r) => (
            <div key={r.label} className="summary-row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">Your choices show up here as you go.</p>
      )}
    </section>
  );
}
