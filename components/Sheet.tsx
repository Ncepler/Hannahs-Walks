"use client";

import { animate, motion, useMotionTemplate, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface SheetApi {
  /** Animate out, then call `onClose`. */
  close: () => void;
  /** True while the sheet rests at its top snap point and the list may scroll. */
  atTop: boolean;
  desktop: boolean;
  /**
   * Put on the footer so its actions stay at the bottom of the screen at the first stop, then
   * leave with the sheet when it is dismissed. Null on a desktop panel.
   */
  lift: MotionValue<string> | null;
}

const SNAP_OPEN = 0.6; // fraction of the viewport the sheet covers at its first stop
const SNAP_FULL = 0.92;
const SPRING = { type: "spring", duration: 0.45, bounce: 0.12 } as const;
const SPRING_DISMISS = { type: "spring", duration: 0.4, bounce: 0 } as const; // leaving never overshoots
const FLICK = 250; // px/s: faster than this and the direction of travel decides
const RUBBER = 0.3; // past the top stop, the sheet follows the finger at this fraction
const PROJECT_S = 0.2; // momentum: where the sheet would coast to in this many seconds

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on a phone, side panel on a desktop (§15.6).
 * The sheet tracks the finger 1:1, projects momentum on release, hands the release velocity to a
 * spring, and can be grabbed again mid-flight. The panel just slides in.
 */
export function Sheet({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: (api: SheetApi) => ReactNode;
}) {
  const reduced = !!useReducedMotion();
  const [desktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);

  const vh = useRef(typeof window !== "undefined" ? window.innerHeight : 800);
  const closedY = vh.current * SNAP_FULL + 32;
  const midY = vh.current * (SNAP_FULL - SNAP_OPEN);

  const y = useMotionValue(closedY);
  const transform = useMotionTemplate`translateY(${y}px)`;
  const lift = useTransform(y, (v) => `translateY(${-Math.max(0, Math.min(v, midY))}px)`);
  const [atTop, setAtTop] = useState(false);
  const atTopRef = useRef(false);
  const [state, setState] = useState<"pre" | "in" | "out">("pre");
  const closing = useRef(false);
  const [opener] = useState(() => (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null));
  const root = useRef<HTMLElement | null>(null);
  const controls = useRef<ReturnType<typeof animate> | null>(null);

  // A dismissal that has been grabbed and cancelled must not still close the sheet when it completes.
  const finish = useCallback(() => {
    if (closing.current) onClose();
  }, [onClose]);

  // Opening: the sheet springs up from the bottom, the panel slides in.
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
    if (desktop || reduced) {
      if (!desktop) y.set(midY);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setState("in")));
      return () => cancelAnimationFrame(r);
    }
    setState("in");
    controls.current = animate(y, midY, SPRING);
    return () => controls.current?.stop();
  }, [desktop, reduced, midY, y]);

  useEffect(() => {
    const unsub = y.on("change", (v) => {
      const top = v <= 1;
      if (top !== atTopRef.current) {
        atTopRef.current = top;
        setAtTop(top);
      }
    });
    return unsub;
  }, [y]);

  // Return focus to whatever opened the sheet; keep the page behind it still while a phone sheet is up.
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    if (!desktop) {
      shell?.setAttribute("inert", "");
      document.documentElement.style.overflow = "hidden";
    }
    return () => {
      shell?.removeAttribute("inert");
      document.documentElement.style.overflow = "";
      opener?.focus?.({ preventScroll: true });
    };
  }, [desktop, opener]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setState("out");
    if (desktop || reduced) {
      window.setTimeout(finish, desktop ? 280 : 200);
      return;
    }
    controls.current?.stop();
    controls.current = animate(y, closedY, { ...SPRING_DISMISS, onComplete: finish });
  }, [desktop, reduced, y, closedY, finish]);

  /* ---------- Drag (phone only) ---------- */

  const g = useRef<object | null>(null);

  const settle = (v: number) => {
    const cur = y.get();
    const snaps = [0, midY, closedY];
    let from = snaps;
    if (v > FLICK) from = snaps.filter((s) => s > cur + 8); // moving down: at least the next stop down
    else if (v < -FLICK) from = snaps.filter((s) => s < cur - 8);
    if (!from.length) from = v > 0 ? [closedY] : [0];
    const projected = cur + v * PROJECT_S;
    const target = from.reduce((a, b) => (Math.abs(b - projected) < Math.abs(a - projected) ? b : a));
    if (target === closedY) {
      closing.current = true;
      setState("out");
    }
    controls.current?.stop();
    const onComplete = target === closedY ? finish : undefined;
    controls.current = animate(y, target, reduced ? { duration: 0, onComplete } : { ...(target === closedY ? SPRING_DISMISS : SPRING), velocity: v, onComplete });
  };

  // Moves and releases are heard on the window for the length of a gesture: the handle sits on the
  // sheet's top edge, so a drag leaves the sheet at once, and capture only starts once intent is clear.
  const detach = useRef<(() => void) | null>(null);
  useEffect(() => () => detach.current?.(), []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (desktop || (e.pointerType === "mouse" && e.button !== 0)) return;
    const t = e.target as HTMLElement;
    if (t.closest("[data-nodrag]")) return;
    const onHandle = !!t.closest("[data-drag]");
    const onList = !!t.closest("[data-scroll]");
    // The list scrolls only at the top stop; below it, a vertical drag moves the sheet.
    if (!onHandle && !(onList && !atTopRef.current)) return;
    controls.current?.stop(); // grab it wherever it is right now, even on its way out
    if (closing.current) {
      closing.current = false;
      setState("in");
    }
    const s = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: y.get(), active: false, samples: [] as { t: number; y: number }[] };
    g.current = s;
    detach.current?.();

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== s.id) return;
      if (!s.active) {
        const dy = ev.clientY - s.y0;
        if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(ev.clientX - s.x0)) return; // wait for intent
        s.active = true; // keep y0 and base: the sheet stays exactly where it was grabbed relative to the finger
        try {
          root.current?.setPointerCapture(ev.pointerId);
        } catch {
          /* the pointer may already be gone */
        }
      }
      const raw = s.base + (ev.clientY - s.y0);
      y.set(raw < 0 ? raw * RUBBER : raw);
      s.samples.push({ t: ev.timeStamp, y: raw });
      while (s.samples.length > 2 && ev.timeStamp - s.samples[0].t > 100) s.samples.shift();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== s.id) return;
      stop();
      g.current = null;
      if (!s.active) return; // a tap: let the click through
      const first = s.samples[0];
      const last = s.samples[s.samples.length - 1];
      const dt = first && last ? (last.t - first.t) / 1000 : 0;
      settle(ev.type === "pointercancel" || dt <= 0 ? 0 : (last.y - first.y) / dt);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      detach.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    detach.current = stop;
  };

  /* ---------- Keyboard: Esc closes, Tab stays inside a phone sheet ---------- */

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [close]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || desktop || !root.current) return;
    const items = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const api: SheetApi = { close, atTop, desktop, lift: desktop ? null : lift };

  if (typeof document === "undefined") return null;

  if (desktop) {
    return createPortal(
      <aside
        ref={(el) => {
          root.current = el;
        }}
        className="panel"
        data-state={state}
        role="dialog"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {children(api)}
      </aside>,
      document.body,
    );
  }

  return createPortal(
    <div className="sheet-root" data-reduced={reduced} data-state={state} onKeyDown={onKeyDown}>
      <div className="scrim" data-state={state === "in" ? "on" : "off"} onClick={close} aria-hidden="true" />
      <motion.section
        ref={(el: HTMLElement | null) => {
          root.current = el;
        }}
        className="sheet"
        data-top={atTop}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={{ transform }}
        onPointerDown={onPointerDown}
      >
        <div className="sheet-handle" data-drag>
          <span />
        </div>
        {children(api)}
      </motion.section>
    </div>,
    document.body,
  );
}
