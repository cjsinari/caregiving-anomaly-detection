/*
 * A stable identifier for this workstation.
 *
 * The service scores a sign-in partly on whether it has seen the device before,
 * and trusts a device once it has passed a step-up challenge. Without a stable
 * value the console would be an unrecognised device every single time, which
 * means a second code on every sign-in and a permanently inflated risk score
 * for the one account that reviews risk scores.
 *
 * This is deliberately in localStorage, which the token store refuses to use.
 * The distinction is what the value is worth to someone who steals it: a device
 * id is not a credential. It proves nothing on its own — presenting it still
 * requires the phone that receives the code — and the service treats a
 * recognised device as one weak signal among five, not as authentication. A
 * token, by contrast, *is* the authority, which is why that one never touches
 * a store a script can read.
 *
 * Not fingerprinted from browser characteristics. A random value per
 * installation identifies the workstation just as well for this purpose,
 * without building a tracking identifier that follows the person elsewhere.
 */

const KEY = 'mzazicare.deviceId';

function randomId() {
  if (globalThis.crypto?.randomUUID) return `console-${globalThis.crypto.randomUUID()}`;
  return `console-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * This workstation's id, created on first use.
 *
 * Falls back to a per-tab value when storage is unavailable — a private window,
 * or a browser with site data blocked. The console still works there; the
 * device is simply never remembered, so step-up is asked for each time, which
 * is the correct outcome rather than an error.
 */
let inMemory = null;

export function getDeviceId() {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return stored;
    const created = randomId();
    window.localStorage.setItem(KEY, created);
    return created;
  } catch {
    if (!inMemory) inMemory = randomId();
    return inMemory;
  }
}

/** A label for the trusted-device list, so an administrator can recognise it. */
export function getDeviceLabel() {
  const ua = navigator.userAgent || '';
  const platform = /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS/.test(ua) ? 'Mac'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown';
  return `Security console (${platform})`;
}
