"use client";

/** A labelled checkbox that fills its row. Keyboard and screen-reader friendly. */
export function CheckRow({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className="check-row pressable" onClick={() => onChange(!checked)}>
      <span className="check-box" aria-hidden="true">
        <svg className="check-mark" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="m2.5 7.5 3 3 6-7" />
        </svg>
      </span>
      <span>
        <span className="check-label">{label}</span>
        {sub && <span className="check-sub">{sub}</span>}
      </span>
    </button>
  );
}
