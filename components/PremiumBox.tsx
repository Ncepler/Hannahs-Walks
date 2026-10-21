"use client";

import { COPY, PREMIUM_MAX_CHARS } from "@/lib/config";

/** Placeholder until the describe-a-walk planner is wired up. Everything is disabled. */
export function PremiumBox() {
  return (
    <section className="premium" aria-labelledby="premium-title">
      <h2 id="premium-title" className="q-title">
        Describe the walk you want
      </h2>
      <div className="field" aria-disabled="true">
        <textarea
          className="textarea"
          rows={4}
          disabled
          maxLength={PREMIUM_MAX_CHARS}
          placeholder={COPY.premiumPlaceholder}
          aria-label="Describe the walk you want"
        />
        <span className="counter muted" aria-hidden="true">{`0 / ${PREMIUM_MAX_CHARS}`}</span>
      </div>
      <div className="opts">
        {COPY.premiumExamples.map((ex) => (
          <button key={ex} type="button" className="chip" disabled>
            {ex}
          </button>
        ))}
      </div>
      <div className="bar">
        <span className="bar-gap" />
        <button type="button" className="btn btn-primary grow" disabled>
          {COPY.plan}
        </button>
      </div>
    </section>
  );
}
