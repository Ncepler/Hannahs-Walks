"use client";

import { useEffect, useRef } from "react";
import { COPY, PREMIUM_MAX_CHARS } from "@/lib/config";
import { CheckRow } from "./CheckRow";

const MAX_LINES = 6;

/** One free-text box: describe the walk (§13.2). Grows to six lines, 16 px so iOS does not zoom. */
export function PremiumBox({
  text,
  onText,
  returnHome,
  onReturnHome,
  onSubmit,
  busy,
}: {
  text: string;
  onText: (t: string) => void;
  returnHome: boolean;
  onReturnHome: (v: boolean) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const empty = !text.trim();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 24;
    const max = line * MAX_LINES + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  const submit = () => {
    if (!empty && !busy) onSubmit();
  };

  return (
    <section className="premium" aria-labelledby="premium-title">
      <h2 id="premium-title" className="q-title">
        Describe the walk you want
      </h2>
      <div className="field">
        <textarea
          ref={box}
          className="textarea"
          rows={3}
          maxLength={PREMIUM_MAX_CHARS}
          value={text}
          placeholder={COPY.premiumPlaceholder}
          aria-labelledby="premium-title"
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <span className="counter muted" aria-hidden="true">{`${text.length} / ${PREMIUM_MAX_CHARS}`}</span>
      </div>
      <div className="opts">
        {COPY.premiumExamples.map((ex) => (
          <button
            key={ex}
            type="button"
            className="chip pressable"
            onClick={() => {
              onText(ex);
              box.current?.focus();
            }}
          >
            {ex}
          </button>
        ))}
      </div>
      <CheckRow checked={returnHome} onChange={onReturnHome} label="End back at Home" sub="Uncheck it if you don’t need to walk home." />
      <div className="bar">
        <span className="bar-gap" />
        <button type="button" className="btn btn-primary pressable grow" onClick={submit} disabled={empty || busy}>
          {COPY.plan}
        </button>
      </div>
    </section>
  );
}
