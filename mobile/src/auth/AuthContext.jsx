import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as session from './session';
import { auth } from '../api/endpoints';
import { ApiError } from '../api/client';

/*
 * Who is signed in, and the three things the app can do about it.
 *
 * One piece of state decides which half of the app is mounted:
 *
 *   restoring  -- reading the keychain and confirming with the service. The
 *                 splash screen is still up; nothing is rendered yet.
 *   signedOut  -- the auth stack. `notice` says why, when the session ended by
 *                 itself rather than by someone tapping Sign out.
 *   signedIn   -- the app stack, with `user` populated.
 *
 * Navigation follows from that rather than from a `navigate` call, which is
 * what makes back-navigation into a signed-out app impossible: the protected
 * screens are not unmounted and left on the stack, they were never mounted.
 * There is no history to go back into. (#46 builds the role-specific stacks
 * behind this; #42 only has to make the choice correct.)
 */

const AuthContext = createContext(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider');
  return value;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('restoring');
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState(null);

  // Set once the provider unmounts, so a slow restore that finishes afterwards
  // does not call setState on a dead component.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /*
   * The session ended underneath us.
   *
   * Fired by api/client.js when the service refuses a refresh, when an
   * administrator revokes the session, or when the risk engine flags it. The
   * tokens are already gone by the time this runs -- this is the part that
   * takes the protected screens off the display and says why.
   */
  useEffect(() => session.onSessionLost((reason) => {
    if (!alive.current) return;
    setUser(null);
    setNotice(reason || 'Your session ended. Please sign in again.');
    setStatus('signedOut');
  }), []);

  /*
   * Restore on launch, behind the splash screen.
   *
   * The stored profile is used only when the service cannot be reached. A
   * launch with no signal should not sign a caregiver out of an app they were
   * using five minutes ago -- the tokens are still valid and the first
   * authenticated request will say so. Any *answer* from the service, on the
   * other hand, is authoritative: a refused refresh has already cleared the
   * keychain through the interceptor by the time the error arrives here.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await session.load();
      if (cancelled || !alive.current) return;

      if (!stored) {
        setStatus('signedOut');
        return;
      }

      try {
        const fresh = await auth.me();
        if (cancelled || !alive.current) return;
        setUser(fresh);
        setStatus('signedIn');
      } catch (err) {
        if (cancelled || !alive.current) return;
        if (err instanceof ApiError && err.isNetwork) {
          const cached = session.getStoredUser();
          if (cached) {
            setUser(cached);
            setStatus('signedIn');
            return;
          }
        }
        // Either the session is genuinely over -- onSessionLost has already
        // run and set the notice -- or there was nothing cached to fall back
        // on. Both end at the sign-in screen.
        setStatus((current) => (current === 'restoring' ? 'signedOut' : current));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /**
   * Take the tokens a successful verification returned and become signed in.
   *
   * The service answers sign-in with the session and a small user object, so
   * there is no second round trip here to find out who just signed in.
   */
  const signIn = useCallback(async (payload) => {
    await session.save({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      user: payload.user,
    });
    if (!alive.current) return;
    setUser(payload.user || null);
    setNotice(null);
    setStatus('signedIn');
  }, []);

  /**
   * Sign out: revoke on the service first, then clear locally.
   *
   * The revoke is best-effort and its failure is swallowed on purpose. If the
   * call cannot be made -- no signal, or an access token the service has
   * already stopped accepting -- the person still has to end up signed out on
   * this phone. Leaving them signed in because the network was down would be
   * the worst reading of "logout failed", particularly on a shared device.
   *
   * The refresh token stops working either way: either the service revoked the
   * session, or the token is deleted here and no copy of it remains.
   */
  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } catch (err) {
      console.warn('Could not revoke the session on the server:', err?.message);
    }
    await session.clear();
    if (!alive.current) return;
    setUser(null);
    setNotice(null);
    setStatus('signedOut');
  }, []);

  /** Clear the "why you were signed out" line once it has been read. */
  const dismissNotice = useCallback(() => setNotice(null), []);

  const value = useMemo(() => ({
    status, user, notice, signIn, signOut, dismissNotice,
    isSignedIn: status === 'signedIn',
    isRestoring: status === 'restoring',
  }), [status, user, notice, signIn, signOut, dismissNotice]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
