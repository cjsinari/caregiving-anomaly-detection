import { useCallback, useEffect, useState } from 'react';

/*
 * Light, dark, or whatever the operating system says.
 *
 * The console is read in a lit office and at 3am, and dark mode in tokens.css
 * is a selected set of steps rather than an inversion, so offering the choice
 * costs nothing beyond remembering it.
 *
 * The preference is kept in localStorage, which is the right store for it: it
 * is not a credential, losing it is invisible, and it has to survive a reload
 * to be worth having. Every access is guarded — in a private window or with
 * site data blocked, reading throws, and a theme toggle must not be able to
 * take the console down.
 */

const KEY = 'mzazicare.theme';
const MODES = ['system', 'light', 'dark'];

function read() {
  try {
    const stored = window.localStorage.getItem(KEY);
    return MODES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function apply(mode) {
  const root = document.documentElement;
  // Removing the attribute hands control back to the prefers-color-scheme
  // query, which is what 'system' means.
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

export function useTheme() {
  const [mode, setMode] = useState(read);

  useEffect(() => {
    apply(mode);
    try { window.localStorage.setItem(KEY, mode); } catch { /* nothing to do */ }
  }, [mode]);

  /** Cycle through the three, so one control covers all of them. */
  const cycle = useCallback(() => {
    setMode((current) => MODES[(MODES.indexOf(current) + 1) % MODES.length]);
  }, []);

  return { mode, setMode, cycle };
}
