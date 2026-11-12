import Constants from 'expo-constants';

/*
 * The one place the app talks to the auth service.
 *
 * Deliberately small for now. Issue #41 only has to register someone, which is
 * an unauthenticated call, so there is no token handling in this file yet --
 * that arrives with issue #42, which adds encrypted storage, an interceptor
 * and a single in-flight refresh. The shape here is chosen so that lands as an
 * addition rather than a rewrite: everything already goes through `send`.
 *
 * ── Where the base URL comes from ──
 *
 * app.json's `extra.apiBaseUrl`, defaulting to the Android emulator's alias
 * for the host machine. A device on the same wifi needs the host's LAN
 * address instead, which is a one-line change in app.json rather than a hunt
 * through source files. See mobile/README.md.
 */

const BASE = String(
  Constants.expoConfig?.extra?.apiBaseUrl || 'http://10.0.2.2:3000'
).replace(/\/$/, '');

/** How long to wait before calling it a dead network. */
const TIMEOUT_MS = 15000;

/**
 * An error carrying what the service said, so a screen can act on the code
 * rather than pattern-match on a message that might be reworded tomorrow.
 *
 * `details` is the field-level list the service's validator returns:
 * `[{ field, message }]`. The registration form feeds it straight back into
 * React Hook Form, which is what puts a backend complaint under the right
 * input instead of in a banner at the top.
 */
export class ApiError extends Error {
  constructor(message, { status, code, details, retryAfterSeconds } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** Nothing answered. Worth a retry; not worth blaming the person's input. */
  get isNetwork() {
    return this.code === 'NETWORK' || this.code === 'TIMEOUT';
  }

  /** Too many attempts. The screen shows the wait rather than a retry button. */
  get isRateLimited() {
    return this.status === 429 || this.status === 423;
  }
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
}

async function send(method, path, { body, token } = {}) {
  // RN's fetch has no timeout of its own, and a request left hanging on a
  // stalled mobile connection leaves the submit button spinning forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch (err) {
    // Distinguishing "nothing answered" from "the service refused this" matters:
    // they need different words on screen and only one of them is worth a retry.
    if (err.name === 'AbortError') {
      throw new ApiError('The request timed out. Check your connection and try again.',
        { code: 'TIMEOUT' });
    }
    throw new ApiError('Could not reach LindaCare. Check your connection and try again.',
      { code: 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }

  const payload = await readBody(response);
  if (response.ok) return payload;

  throw new ApiError(payload.error || `Request failed (${response.status})`, {
    status: response.status,
    code: payload.code,
    details: payload.details,
    retryAfterSeconds: payload.retryAfterSeconds,
  });
}

export const api = {
  post: (path, body, options) => send('POST', path, { body, ...options }),
  get: (path, options) => send('GET', path, options),
};

export const apiBaseUrl = BASE;
