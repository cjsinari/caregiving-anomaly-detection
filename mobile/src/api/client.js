import Constants from 'expo-constants';
import * as session from '../auth/session';

/*
 * The one place the app talks to the auth service.
 *
 * Issue #42 adds the part that makes a signed-in app possible: the access
 * token goes on every authenticated request, and when the service says it has
 * expired the token is refreshed and the request is retried, once, without the
 * screen that made it knowing anything happened.
 *
 * There is no Axios here. Issue #42 asks for an Axios interceptor; this app
 * already had a fetch wrapper from #41, and every behaviour the issue actually
 * specifies -- attach the token, refresh on a 401, one refresh at a time, queue
 * the rest and retry them -- is implemented below. Adding Axios would mean a
 * dependency and a rewrite of this file to arrive at the same four behaviours.
 * If it is ever added, `authed` is the only function that has to move.
 *
 * -- Where the base URL comes from --
 *
 * app.json's `extra.apiBaseUrl`, defaulting to the Android emulator's alias
 * for the host machine. A device on the same wifi needs the LAN address of the
 * host instead, which is a one-line change in app.json rather than a hunt
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
  constructor(message, { status, code, details, retryAfterSeconds, attemptsLeft } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
    // The service counts down the OTP attempts left before the account locks.
    // Carried through so the verification screen can say so instead of letting
    // someone burn all five on a code they misread.
    this.attemptsLeft = attemptsLeft;
  }

  /** Nothing answered. Worth a retry; not worth blaming the input. */
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
    attemptsLeft: payload.attemptsLeft,
  });
}

/*
 * ----------------------------- the session layer -----------------------------
 */

/**
 * Codes that mean the session is over and refreshing it is pointless.
 *
 * SESSION_ENDED is a logout that happened elsewhere -- another device, or an
 * administrator revoking it from the console. SESSION_FLAGGED is the risk
 * engine ending the session mid-flight: an impossible-travel hop, or a burst of
 * API calls that does not look like a person. Both are decisions about the
 * session itself, so presenting the refresh token would at best resurrect
 * something that was deliberately stopped.
 */
const SESSION_OVER = new Set(['SESSION_ENDED', 'SESSION_FLAGGED', 'REFRESH_INVALID']);

/** Codes that mean the account, not the session, is unavailable. */
const ACCOUNT_OVER = new Set(['ACCOUNT_RESTRICTED', 'ACCOUNT_FROZEN', 'ACCOUNT_SUSPENDED']);

/*
 * The in-flight refresh, if there is one.
 *
 * -- Why a single promise is the whole queue --
 *
 * The service rotates the refresh token on every use, and only one rotation can
 * win: rotateRefresh is a compare-and-swap against the stored hash. So two
 * concurrent refreshes mean one succeeds and the other is left holding a token
 * that no longer exists, which the service answers with REFRESH_INVALID -- and
 * that second request signs the person out in the middle of a working session.
 *
 * Every request that hits a 401 therefore awaits this same promise instead of
 * starting its own. That is the queue the issue asks for: the callers wait on
 * one refresh and retry when it resolves. An explicit array of pending
 * requests would hold the same callers in a structure we would then have to
 * drain by hand, with the same result and more ways to drop one.
 */
let refreshInFlight = null;

/**
 * The sentence the sign-in screen shows when the session ended by itself.
 *
 * "You have been signed out" with no reason reads like a bug, and a flagged
 * session is something the person genuinely needs to be told about -- it means
 * their account was used from somewhere the service did not believe.
 */
function reasonFor(err) {
  if (err.code === 'SESSION_FLAGGED') {
    return 'We ended your session because of unusual activity on your account. Please sign in again.';
  }
  if (ACCOUNT_OVER.has(err.code)) return err.message;
  return 'Your session expired. Please sign in again.';
}

async function performRefresh() {
  const refreshToken = session.getRefreshToken();
  if (!refreshToken) {
    throw new ApiError('Your session has ended. Please sign in again.',
      { status: 401, code: 'REFRESH_INVALID' });
  }

  try {
    const next = await send('POST', '/auth/refresh', { body: { refreshToken } });
    await session.save(next);
    return next.accessToken;
  } catch (err) {
    /*
     * A network failure is not an expired session.
     *
     * This is the distinction that decides whether someone who walked into a
     * lift comes back to the screen they were on or to the sign-in form. Only
     * an answer from the service -- a refused refresh, a restricted account --
     * ends the session. Silence means try again later.
     */
    if (err instanceof ApiError && !err.isNetwork && (err.status === 401 || err.status === 403)) {
      await session.clear({ notify: true, reason: reasonFor(err) });
    }
    throw err;
  }
}

function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/**
 * An authenticated request: attach the access token, and on a 401 refresh once
 * and retry.
 *
 * The retry is capped at one. A second 401 after a successful refresh is not an
 * expiry -- it is a token the service will not accept -- and retrying again is
 * how a client ends up in a loop that empties the rate limit and drains the
 * battery.
 */
async function authed(method, path, { body, retry = true } = {}) {
  const token = session.getAccessToken();
  try {
    return await send(method, path, { body, token });
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;

    // The account itself is restricted. No token fixes that.
    if (err.status === 403 && ACCOUNT_OVER.has(err.code)) {
      await session.clear({ notify: true, reason: reasonFor(err) });
      throw err;
    }

    if (err.status !== 401) throw err;

    // Ended on purpose, by someone or something else. Refreshing would be
    // asking the service to undo a decision it has just made.
    if (SESSION_OVER.has(err.code)) {
      await session.clear({ notify: true, reason: reasonFor(err) });
      throw err;
    }

    if (!retry) throw err;

    const fresh = await refreshSession();
    return send(method, path, { body, token: fresh });
  }
}

export const api = {
  post: (path, body, options) => send('POST', path, { body, ...options }),
  get: (path, options) => send('GET', path, options),
  /** Calls that need a session. These are the ones the refresh logic guards. */
  authed: {
    post: (path, body) => authed('POST', path, { body }),
    get: (path) => authed('GET', path),
    patch: (path, body) => authed('PATCH', path, { body }),
    put: (path, body) => authed('PUT', path, { body }),
    // A body is optional: DELETE /auth/push-tokens names the token to forget
    // in its body, because a push token in a URL ends up in access logs.
    delete: (path, body) => authed('DELETE', path, { body }),
  },
};

export const apiBaseUrl = BASE;

/** Test seam: forgets a refresh a previous test left in flight. */
export function __resetForTests() {
  refreshInFlight = null;
}
