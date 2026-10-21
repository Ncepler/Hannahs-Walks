"use client";

/** Shown in place of the note box on the static site, where there is no server to plan with. */
export function PremiumOff({ onRegular }: { onRegular: () => void }) {
  return (
    <section className="premium" aria-labelledby="premium-title">
      <h2 id="premium-title" className="q-title">
        Describing a walk is off on this site
      </h2>
      <p className="muted">
        It needs a server to plan with, and this copy is hosted as plain files. Regular mode works here and
        draws on the same streets.
      </p>
      <div className="error-actions">
        <button type="button" className="btn btn-primary pressable" onClick={onRegular}>
          Use regular mode
        </button>
      </div>
    </section>
  );
}
