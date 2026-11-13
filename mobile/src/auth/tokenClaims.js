/*
 * What an access token says about who holds it.
 *
 * ── Why the app reads its own token ──
 *
 * Issue #45: "role changes on the server take effect after the next token
 * refresh." The service already does its half. The refresh handler signs the
 * new access token from the *current* users row (sessionStore.findByRefreshHash
 * joins it fresh, tokens.signAccessToken puts `role` and `status` in the
 * payload), so an administrator moving an account from caregiver to family is
 * in the very next token the phone receives.
 *
 * What did not happen is the app noticing. `user.role` was set at sign-in and
 * re-read from /auth/me only on launch, so a role change sat unnoticed until
 * the app was killed and reopened -- days, on a phone that is never restarted.
 * The refresh response is tokens only, and adding a /auth/me round trip to
 * every refresh would be a second request on the hot path to learn one string
 * the first response already carries.
 *
 * ── This is not verification, and does not need to be ──
 *
 * The signature is not checked, because it cannot be: the key is the
 * service's secret and has no business on a phone. That is fine for what this
 * is used for, which is choosing which screens to *mount*. It decides nothing
 * about what those screens are allowed to *show*: every request still carries
 * the token and the service verifies it and scopes the answer by role. A
 * tampered payload here gets you the other portal's empty screens and a 403 on
 * the first thing they load.
 */

/** base64url → string, without depending on atob being present everywhere. */
function decodeSegment(segment) {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);

  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(padded);
    // atob yields Latin-1; a name in a claim can be UTF-8.
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  throw new Error('No base64 decoder available');
}

/**
 * The payload of a JWT, or null if it is not one.
 *
 * Null rather than a throw, because the one caller is the session layer in the
 * middle of storing a fresh token, and a malformed claim is not a reason to
 * fail a refresh that otherwise worked. It means "no role information here",
 * and the role the app already has stands.
 */
export function readClaims(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(decodeSegment(parts[1]));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/** The roles the app has screens for. Anything else is the web console's. */
export const ROLES = ['caregiver', 'family'];
