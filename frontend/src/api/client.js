/*
 * The one place the dashboard talks to the auth service.
 *
 * ── Where the tokens live ──
 *
 * In module scope. Not localStorage, not sessionStorage, not a non-httpOnly
 * cookie: anything a script can read, a script injected into this page can read
 * too, and the thing it would be reading is an administrator's token for the
 * endpoints that freeze accounts and end sessions. Of the places a token can
 * sit, a module variable is the only one that dies with the tab.
 *
 * The cost is honest and worth stating: a page reload loses the session and
 * returns to the login screen. Persisting the refresh token anywhere a script
 * can reach would trade that inconvenience for exactly the exposure this
 * avoids. The upgrade that removes the cost without reintroducing the risk is
 * an httpOnly, SameSite=Strict refresh cookie set by the service — a change on
 * the API side, not here, and the reason the refresh call is funnelled through
 * one function below: when the cookie exists, `refreshSession` stops sending a
 * body and nothing else in the dashboard changes.
 *
 * ── Why one client ──
 *
 * Expiry handling has to be in exactly one place. The access token is short
 * lived, so any request can be the one that finds it expired, and a dashboard
 * with several panels will find out from four requests at once. A single
 * in-flight refresh promise means those four wait on one refresh and then
 * retry, instead of four refreshes racing to rotate the same token and three of
 * them losing — which the service treats as a replayed token, and rightly so.
 */

const BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

/** An error carrying what the service said, so a component can act on the code. */
export class ApiError extends Error {
  constructor(message, { status, code, details, retryAfterSeconds } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** True when retrying is pointless until the administrator signs in again. */
  get isSessionLoss() {
    return this.status === 401 || this.code === 'SESSION_ENDED' || this.code === 'REFRESH_INVALID';
  }

  /** True when the account itself was refused, not the request. */
  get isForbidden() {
    return this.status === 403;
  }
}

// ───────────────────────── token store ─────────────────────────

let accessToken = null;
let refreshToken = null;
let refreshInFlight = null;

/** Subscribers notified once when the session is gone for good. */
const sessionLostListeners = new Set();

export function setTokens({ accessToken: access, refreshToken: refresh }) {
  accessToken = access || null;
  if (refresh !== undefined) refreshToken = refresh || null;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
  refreshInFlight = null;
}

export const hasSession = () => Boolean(accessToken);

/**
 * Register a callback for irrecoverable session loss — an expired refresh
 * token, a session an administrator ended from another device, an account that
 * was suspended mid-session. The auth context uses it to return to the login
 * screen from wherever the dashboard happens to be.
 */
export function onSessionLost(listener) {
  sessionLostListeners.add(listener);
  return () => sessionLostListeners.delete(listener);
}

function announceSessionLost(reason) {
  clearTokens();
  sessionLostListeners.forEach((listener) => {
    try { listener(reason); } catch (err) { console.error('session-lost listener failed:', err); }
  });
}

// ───────────────────────── requests ─────────────────────────

async function readBody(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
}

function toQuery(params) {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    // An empty filter means "no filter", so it is left off the URL entirely
    // rather than sent as an empty string the service would have to reject.
    if (value === undefined || value === null || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function send(method, path, { body, params, token = accessToken, signal } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}${toQuery(params)}`, {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch (err) {
    // A thrown fetch is the network, not the service. Distinguishing the two
    // matters: "the service refused this" and "nothing answered" need different
    // things from the person reading the screen.
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the authentication service.', { code: 'NETWORK' });
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

/**
 * Exchange the refresh token for a new pair.
 *
 * Deduplicated: concurrent callers share one in-flight request. The service
 * rotates the refresh token on every use and treats a second use of the old one
 * as a replay, so two parallel refreshes would end the session rather than
 * extend it.
 */
export function refreshSession() {
  if (refreshInFlight) return refreshInFlight;
  if (!refreshToken) return Promise.reject(new ApiError('No session to refresh.', { status: 401 }));

  refreshInFlight = send('POST', '/auth/refresh', { body: { refreshToken }, token: null })
    .then((tokens) => {
      setTokens(tokens);
      return tokens;
    })
    .finally(() => { refreshInFlight = null; });

  return refreshInFlight;
}

/**
 * An authenticated request that survives the access token expiring underneath
 * it: on an expired-token answer it refreshes once and replays the request.
 *
 * Only TOKEN_EXPIRED is retried. The other 401s are not retryable and must not
 * be — SESSION_ENDED means someone ended this session deliberately, and
 * refreshing past that would be the dashboard arguing with a revocation.
 */
async function authed(method, path, options = {}) {
  try {
    return await send(method, path, options);
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;

    if (err.status === 401 && err.code === 'TOKEN_EXPIRED' && refreshToken) {
      try {
        await refreshSession();
      } catch {
        announceSessionLost('expired');
        throw new ApiError('Your session has expired. Please sign in again.',
          { status: 401, code: 'REFRESH_INVALID' });
      }
      return send(method, path, { ...options, token: accessToken });
    }

    if (err.status === 401 || err.code === 'ACCOUNT_RESTRICTED') {
      announceSessionLost(err.code === 'SESSION_FLAGGED' ? 'flagged' : 'ended');
    }
    throw err;
  }
}

export const api = {
  get: (path, params, options) => authed('GET', path, { params, ...options }),
  post: (path, body, options) => authed('POST', path, { body, ...options }),
  patch: (path, body, options) => authed('PATCH', path, { body, ...options }),
  del: (path, options) => authed('DELETE', path, options),

  /** Unauthenticated calls: the two steps of signing in. */
  public: {
    post: (path, body) => send('POST', path, { body, token: null }),
  },
};
