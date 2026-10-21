"use client";

import { useRef, useState } from "react";
import { Sheet, type SheetApi } from "./Sheet";

function Form({ api, onUnlocked }: { api: SheetApi; onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || busy) return;
    setBusy(true);
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, scope: "premium" }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onUnlocked();
      api.close();
      return;
    }
    setWrong(true);
    setShake(true); // once, 240 ms
    window.setTimeout(() => setShake(false), 260);
    input.current?.select();
  };

  return (
    <form className="lock" onSubmit={submit}>
      <div className="dir-head-row" data-drag>
        <h2 id="lock-title" className="dir-title">
          Premium is for subscribers
        </h2>
        <button type="button" className="icon-btn pressable" data-nodrag onClick={api.close} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="lock-row" data-shake={shake} data-nodrag>
        <label htmlFor="premium-code" className="sr-only">
          Passcode
        </label>
        <input
          id="premium-code"
          ref={input}
          className="textarea input"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          placeholder="Passcode"
          value={code}
          onFocus={api.expand}
          onChange={(e) => {
            setCode(e.target.value);
            setWrong(false);
          }}
          aria-invalid={wrong}
          aria-describedby={wrong ? "premium-code-error" : undefined}
        />
        <button type="submit" className="btn btn-primary pressable" disabled={!code || busy} data-nodrag>
          Unlock
        </button>
      </div>
      {wrong && (
        <p id="premium-code-error" className="relaxed" role="alert">
          That code didn&rsquo;t work.
        </p>
      )}
    </form>
  );
}

/** Asked for instead of switching to Premium when a passcode is set and this browser has not entered it. */
export function PasscodeSheet({ onUnlocked, onClose }: { onUnlocked: () => void; onClose: () => void }) {
  return (
    <Sheet labelledBy="lock-title" onClose={onClose}>
      {(api) => <Form api={api} onUnlocked={onUnlocked} />}
    </Sheet>
  );
}
