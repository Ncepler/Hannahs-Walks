"use client";

import { useState } from "react";
import { APP_NAME } from "@/lib/config";

/** Shown in place of any page while SITE_PASSCODE is set and this browser has not entered it. */
export default function Unlock() {
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || busy) return;
    setBusy(true);
    const res = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, scope: "site" }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) window.location.reload();
    else setWrong(true);
  };

  return (
    <main className="wrap unlock">
      <form className="card unlock-card" onSubmit={submit}>
        <h1 className="card-title">{APP_NAME}</h1>
        <label className="muted" htmlFor="code">
          Enter the passcode to continue.
        </label>
        <input
          id="code"
          className="textarea input"
          type="password"
          autoComplete="current-password"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setWrong(false);
          }}
        />
        {wrong && (
          <p className="relaxed" role="alert">
            That code didn&rsquo;t work.
          </p>
        )}
        <button type="submit" className="btn btn-primary pressable" disabled={!code || busy}>
          Unlock
        </button>
      </form>
    </main>
  );
}
