import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * Lock the console after a period of no activity.
 *
 * ── Why a security console needs this specifically ──
 *
 * This screen shows the whole service's security history, the accounts on it,
 * and the controls to freeze any of them. It is also the screen most likely to
 * be left open on a shared desk at 3am by someone who has gone to make tea. The
 * access token expires on its own in fifteen minutes, but the console keeps
 * renewing it for as long as the tab is open — which is right for someone
 * working and wrong for a tab nobody is sitting at.
 *
 * ── What counts as activity ──
 *
 * Real input only: keys, pointer, scroll, touch. Deliberately not the timer
 * that refreshes the panels, which is the mistake that makes an idle timeout
 * decorative — a dashboard that polls every minute would renew its own idle
 * deadline forever and never lock.
 *
 * Listeners are passive and the deadline is a timestamp compared on a slow
 * interval, rather than a timer reset per event. A mousemove handler that
 * cleared and recreated a timeout would run hundreds of times a second while
 * someone moves the pointer across a chart.
 *
 * ── The warning ──
 *
 * A minute before locking, the viewer is told. Being signed out mid-sentence
 * with no warning is how people learn to keep a second tab open to avoid it,
 * which defeats the control.
 */

const WARN_BEFORE_MS = 60_000;
const CHECK_EVERY_MS = 5_000;

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'focus'];

export function useIdleTimeout({ enabled, timeoutMinutes, onTimeout }) {
  const timeoutMs = Math.max(Number(timeoutMinutes) || 0, 0) * 60_000;
  const lastActivity = useRef(Date.now());

  /*
   * onTimeout is held in a ref, not read from the effect's dependencies.
   *
   * Most callers pass an inline arrow, which is a new function on every render.
   * With it in the dependency list the effect tore down and set up again on
   * each render — and setting up calls markActive(), so every re-render pushed
   * the deadline back. The warning itself causes a re-render, so the timeout
   * could never fire at all: the control looked present and did nothing.
   */
  const timeoutHandler = useRef(onTimeout);
  timeoutHandler.current = onTimeout;
  const [msRemaining, setMsRemaining] = useState(null);
  const fired = useRef(false);

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
    fired.current = false;
    setMsRemaining(null);
  }, []);

  useEffect(() => {
    if (!enabled || !timeoutMs) return undefined;

    markActive();
    const options = { passive: true, capture: true };
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, markActive, options));

    const interval = setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;
      const left = timeoutMs - idleFor;

      if (left <= 0) {
        // Guarded so a slow sign-out cannot be started twice by the next tick.
        if (!fired.current) {
          fired.current = true;
          timeoutHandler.current();
        }
        return;
      }
      setMsRemaining(left <= WARN_BEFORE_MS ? left : null);
    }, CHECK_EVERY_MS);

    return () => {
      clearInterval(interval);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActive, options));
    };
    // Deliberately not depending on onTimeout: see the ref above.
  }, [enabled, timeoutMs, markActive]);

  return {
    /** Milliseconds left, only once inside the warning window; null otherwise. */
    msRemaining,
    /** Dismiss the warning by declaring activity. */
    stayActive: markActive,
  };
}
