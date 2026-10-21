"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculating } from "@/components/Calculating";
import { Directions } from "@/components/Directions";
import { BrandMark, Contours, RefreshIcon } from "@/components/icons";
import { ModeToggle, type Mode } from "@/components/ModeToggle";
import { PasscodeSheet } from "@/components/PasscodeSheet";
import { PremiumBox } from "@/components/PremiumBox";
import { Sheet } from "@/components/Sheet";
import { RouteCard } from "@/components/RouteCard";
import { emptyForm, STEP_COUNT, Summary, toAnswers, Wizard, type Form } from "@/components/Wizard";
import { APP_NAME, COPY, relaxedLine } from "@/lib/config";
import { joinList } from "@/lib/describe";
import { isOneWay, validatePath } from "@/lib/graph";
import { selectWaypoints } from "@/lib/maps";
import { apiFetch } from "@/lib/api";
import { another, plan, routeFromPath, type Answers, type PlanSession, type PoolRoute } from "@/lib/score";
import { PLANNER_CONNECTED } from "@/lib/site";
import type { Mood, Pace } from "@/lib/types";

type Phase = "asking" | "calculating" | "result";
type AiPhase = Phase | "error";
type AiError = "rate" | "network" | "server" | "unconnected";
interface AiResult {
  route: PoolRoute;
  mood: Mood;
  why: string;
  caveat?: string;
}
const AI_MESSAGE: Record<AiError, string> = {
  rate: "That's enough planning for today. Try again tomorrow, or switch to regular.",
  network: "Couldn't reach the planner. Check your connection.",
  server: "The planner had a hiccup. Regular mode still works.",
  unconnected: "Monthly planning isn't connected on this site yet. Regular mode still works.",
};
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

  const [aiText, setAiText] = useState("");
  const [aiReturnHome, setAiReturnHome] = useState(true);
  const [aiPhase, setAiPhase] = useState<AiPhase>("asking");
  const [ai, setAi] = useState<AiResult | null>(null);
  const [aiError, setAiError] = useState<AiError>("server");
  const aiAbort = useRef<AbortController | null>(null);
  const aiSeen = useRef<string[]>([]); // walks already shown for this note, so a refresh brings a different one
  const aiAgain = useRef(false); // whether the last request was a refresh, so "Try again" repeats it faithfully
  const [spins, setSpins] = useState(0);
  const [premiumOK, setPremiumOK] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);

  const [dirOpen, setDirOpen] = useState(false);
  const [startFromHome, setStartFromHome] = useState(false);
  const dirRoute = mode === "regular" ? route : (ai?.route ?? null);
  const plan4 = useMemo(() => (dirRoute ? selectWaypoints(dirRoute.path) : null), [dirRoute]);

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
      if (PLANNER_CONNECTED && localStorage.getItem(MODE_KEY) === "premium") {
        // Come back to Premium only if it is open to this browser.
        apiFetch("/api/unlock?scope=premium")
          .then((r) => r.json())
          .then((j) => {
            if (!j.required || j.unlocked) {
              setPremiumOK(true);
              setMode("premium");
            }
          })
          .catch(() => {});
      }
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

  /** Premium may ask for a passcode first; the switch waits for it. */
  const requestMode = async (m: Mode) => {
    if (m === "regular" || premiumOK || !PLANNER_CONNECTED) return changeMode(m); // no server to ask
    try {
      const j = await (await apiFetch("/api/unlock?scope=premium")).json();
      if (!j.required || j.unlocked) {
        setPremiumOK(true);
        changeMode(m);
      } else setLockOpen(true);
    } catch {
      changeMode(m); // cannot tell; the planner itself will say if it is locked
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

  const cancelAi = useCallback(() => {
    aiAbort.current?.abort();
    aiAbort.current = null;
    setAiPhase("asking");
  }, []);

  /** Sends the note to /api/plan. The answer is re-validated here; server numbers are never trusted. */
  const planAi = async (another: boolean) => {
    const prompt = aiText.trim();
    if (!prompt || aiPhase === "calculating") return;
    aiAgain.current = another;
    if (!another) aiSeen.current = []; // a new note starts afresh
    const fail = (e: AiError) => {
      setAiError(e);
      setAiPhase("error");
    };
    if (!PLANNER_CONNECTED) return fail("unconnected");
    const ac = new AbortController();
    aiAbort.current = ac;
    setAiPhase("calculating");
    try {
      const res = await apiFetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, returnHome: aiReturnHome, avoid: aiSeen.current }),
        signal: ac.signal,
      });
      if (res.status === 401) {
        setPremiumOK(false);
        setAiPhase("asking");
        return setLockOpen(true);
      }
      if (res.status === 429) return fail("rate");
      if (!res.ok) return fail("server");
      const data = await res.json();
      const path: string[] = Array.isArray(data.path) ? data.path : [];
      if (!validatePath(path, { oneWay: isOneWay(path) }).ok) return fail("server");
      const moods: Mood[] = data.mood === "clear" || data.mood === "workout" || data.mood === "ponder" ? [data.mood] : [];
      aiSeen.current = [...aiSeen.current, path.join(">")].slice(-5);
      const found = routeFromPath("AI", String(data.title ?? "Your walk"), "ai", path, moods);
      setAi({ route: found, mood: moods[0] ?? found.moods[0], why: String(data.why ?? ""), caveat: data.caveat ? String(data.caveat) : undefined });
      setAiPhase("result");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      fail("network");
    }
  };

  useEffect(() => {
    if (phase !== "calculating" && aiPhase !== "calculating") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (phase === "calculating") cancel();
      if (aiPhase === "calculating") cancelAi();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, aiPhase, cancel, cancelAi]);

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
  const submitAi = () => planAi(false);
  const refreshAi = () => planAi(true);
  const retryAi = () => planAi(aiAgain.current);

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
  const showing = regular ? phase : aiPhase;
  const resultShown = showing === "result";

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wrap topbar-in">
          <div className="brand">
            <BrandMark />
            <span className="brand-name">{APP_NAME}</span>
          </div>
          <ModeToggle mode={mode} onChange={requestMode} />
        </div>
      </header>

      <main className="wrap layout" data-phase={showing}>
        <div className="pane-left" inert={showing === "calculating"}>
          <Contours />
          <h1 className="hero" data-compact={regular ? !startOfFlow : showing !== "asking"}>
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
            <PremiumBox
              text={aiText}
              onText={setAiText}
              returnHome={aiReturnHome}
              onReturnHome={setAiReturnHome}
              onSubmit={submitAi}
              busy={aiPhase === "calculating"}
            />
          </div>
        </div>

        <div className="pane-right">
          {resultShown && (
            <div className="refresh-row">
              <button
                type="button"
                className="btn btn-secondary pressable refresh"
                onClick={() => {
                  setSpins((n) => n + 1);
                  if (regular) showAnother();
                  else refreshAi();
                }}
              >
                <RefreshIcon turns={spins} />
                Refresh for new route
              </button>
            </div>
          )}
          {regular ? (
            <>
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
            </>
          ) : (
            <>
              {aiPhase === "calculating" && <Calculating lines={COPY.spinnerPremium} stepMs={1400} onCancel={cancelAi} />}
              {aiPhase === "error" && (
                <section className="card error" role="alert">
                  <p className="error-text">{AI_MESSAGE[aiError]}</p>
                  <div className="error-actions">
                    <button
                      type="button"
                      className="btn btn-primary pressable"
                      onClick={() => {
                        setAiPhase("asking"); // the error is done with; Premium reopens on the note
                        changeMode("regular");
                      }}
                    >
                      Use regular mode
                    </button>
                    {(aiError === "network" || aiError === "server") && (
                      <button type="button" className="btn btn-secondary pressable" onClick={retryAi}>
                        Try again
                      </button>
                    )}
                    {(aiError === "network" || aiError === "server") && (
                      <button type="button" className="btn btn-text pressable" onClick={() => setAiPhase("asking")}>
                        Edit my note
                      </button>
                    )}
                  </div>
                </section>
              )}
              {aiPhase === "result" && ai && (
                <RouteCard
                  route={ai.route}
                  mood={ai.mood}
                  pace="steady"
                  premium={{ why: ai.why, caveat: ai.caveat }}
                  onAnother={refreshAi}
                  onChange={() => setAiPhase("asking")}
                  onDirections={() => setDirOpen(true)}
                  startFromHome={startFromHome}
                  onStartFromHome={setStartFromHome}
                />
              )}
            </>
          )}
        </div>
      </main>

      {dirOpen && dirRoute && plan4 && (
        <Sheet labelledBy="dir-title" onClose={() => setDirOpen(false)}>
          {(api) => <Directions route={dirRoute} pace={regular ? planned.pace : "steady"} plan={plan4} startFromHome={startFromHome} api={api} />}
        </Sheet>
      )}

      {lockOpen && (
        <PasscodeSheet
          onUnlocked={() => {
            setPremiumOK(true);
            changeMode("premium");
          }}
          onClose={() => setLockOpen(false)}
        />
      )}

      {!resultShown && (
        <footer className="wrap page-foot">
          <p className="fineprint">{COPY.footer}</p>
        </footer>
      )}
    </div>
  );
}
