"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculating } from "@/components/Calculating";
import { Directions } from "@/components/Directions";
import { BrandMark, Contours } from "@/components/icons";
import { ModeToggle, type Mode } from "@/components/ModeToggle";
import { PremiumBox } from "@/components/PremiumBox";
import { Sheet } from "@/components/Sheet";
import { RouteCard } from "@/components/RouteCard";
import { emptyForm, STEP_COUNT, Summary, toAnswers, Wizard, type Form } from "@/components/Wizard";
import { APP_NAME, COPY, relaxedLine } from "@/lib/config";
import { joinList } from "@/lib/describe";
import { selectWaypoints } from "@/lib/maps";
import { another, plan, type Answers, type PlanSession, type PoolRoute } from "@/lib/score";
import type { Mood, Pace } from "@/lib/types";

type Phase = "asking" | "calculating" | "result";
const MOODS: Mood[] = ["clear", "workout", "ponder"];
const MODE_KEY = "sw_mode";

export default function Page() {
  const [mode, setMode] = useState<Mode>("regular");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(emptyForm);
  const [phase, setPhase] = useState<Phase>("asking");
  const [session, setSession] = useState<PlanSession | null>(null);
  const [route, setRoute] = useState<PoolRoute | null>(null);
  const [planned, setPlanned] = useState<{ mood: Mood; pace: Pace }>({ mood: "clear", pace: "steady" });

  const [dirOpen, setDirOpen] = useState(false);
  const [startFromHome, setStartFromHome] = useState(false);
  const plan4 = useMemo(() => (route ? selectWaypoints(route.path) : null), [route]);

  const formRef = useRef(form);
  const phaseRef = useRef<Phase>("asking");
  const token = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // Remember the last mode. Storage can be blocked, so both directions are guarded.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "premium") setMode("premium");
    } catch {
      /* storage can be blocked */
    }
    // Lets :active fire on the first touch in iOS Safari.
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);
  const changeMode = (m: Mode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage can be blocked */
    }
  };

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  /** The result is computed at once and held until the spinner has run for 1 s (plus up to 150 ms). */
  const run = useCallback((answers: Answers) => {
    if (phaseRef.current === "calculating") return; // a second tap while spinning is ignored
    const mine = ++token.current;
    setPhaseBoth("calculating");
    let result: PlanSession | undefined;
    let waited = false;
    const finish = () => {
      if (token.current !== mine || !result || !waited) return;
      setSession(result);
      setRoute(result.current);
      setPlanned({ mood: answers.mood, pace: answers.pace });
      setPhaseBoth("result");
      try {
        if (/Android/i.test(navigator.userAgent)) navigator.vibrate?.(8);
      } catch {
        /* vibration is optional */
      }
    };
    timers.current = [
      window.setTimeout(() => {
        result = plan(answers); // first run builds the composer's pool; keep it off the click
        finish();
      }, 0),
      window.setTimeout(() => {
        waited = true;
        finish();
      }, 1000 + Math.random() * 150),
    ];
  }, []);

  const cancel = useCallback(() => {
    token.current++;
    clearTimers();
    setPhaseBoth("asking");
  }, []);

  useEffect(() => {
    if (phase !== "calculating") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, cancel]);

  useEffect(() => () => clearTimers(), []);

  const patchForm = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const planNow = () => {
    const f = formRef.current;
    const mood = f.mood ?? MOODS[Math.floor(Math.random() * MOODS.length)];
    if (!f.mood) patchForm({ mood });
    run(toAnswers(f, mood));
  };

  const surprise = () => {
    const mood = MOODS[Math.floor(Math.random() * MOODS.length)];
    setForm({ ...emptyForm, mood });
    run(toAnswers(emptyForm, mood));
  };

  const showAnother = () => {
    if (session) setRoute(another(session));
  };

  const changeAnswers = () => {
    setPhaseBoth("asking");
    setStep(0);
  };

  const note = session
    ? session.closest
      ? COPY.noMatch
      : session.relaxed.length
        ? relaxedLine(joinList(session.relaxed))
        : null
    : null;

  const regular = mode === "regular";
  const startOfFlow = step === 0 && phase === "asking";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wrap topbar-in">
          <div className="brand">
            <BrandMark />
            <span className="brand-name">{APP_NAME}</span>
          </div>
          <ModeToggle mode={mode} onChange={changeMode} />
        </div>
      </header>

      <main className="wrap layout" data-phase={regular ? phase : "asking"}>
        <div className="pane-left" inert={phase === "calculating"}>
          <Contours />
          <h1 className="hero" data-compact={regular && !startOfFlow}>
            {COPY.hero}
          </h1>
          <div hidden={!regular}>
            <Wizard
              step={Math.min(step, STEP_COUNT - 1)}
              form={form}
              onForm={patchForm}
              onStep={setStep}
              onPlan={planNow}
              onSurprise={surprise}
            />
          </div>
          <div hidden={regular}>
            <PremiumBox />
          </div>
        </div>

        {regular && (
          <div className="pane-right">
            {phase === "asking" && <Summary form={form} />}
            {phase === "calculating" && <Calculating lines={COPY.spinnerRegular} stepMs={330} onCancel={cancel} />}
            {phase === "result" && route && (
              <RouteCard
                route={route}
                mood={planned.mood}
                pace={planned.pace}
                note={note}
                onAnother={showAnother}
                onChange={changeAnswers}
                onDirections={() => setDirOpen(true)}
                startFromHome={startFromHome}
                onStartFromHome={setStartFromHome}
              />
            )}
          </div>
        )}
      </main>

      {dirOpen && route && plan4 && (
        <Sheet labelledBy="dir-title" onClose={() => setDirOpen(false)}>
          {(api) => <Directions route={route} pace={planned.pace} plan={plan4} startFromHome={startFromHome} api={api} />}
        </Sheet>
      )}

      {phase !== "result" && (
        <footer className="wrap page-foot">
          <p className="fineprint">{COPY.footer}</p>
        </footer>
      )}
    </div>
  );
}
