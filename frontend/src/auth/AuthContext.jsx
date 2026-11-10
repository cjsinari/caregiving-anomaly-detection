import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, clearTokens, onSessionLost, refreshSession, setTokens } from '../api/client';
import { auth as authApi } from '../api/endpoints';
import { getDeviceId, getDeviceLabel } from './deviceId';

/*
 * Who is signed in, and the sign-in flow that gets them there.
 *
 * ── The role check is here, not only on the server ──
 *
 * A family member can sign in to the auth service perfectly legitimately and
 * receive a valid token; they are simply not entitled to this application. So
 * after the tokens arrive the console asks the service who it just signed in
 * and, if the answer is not an administrator, ends the session it just created
 * and says so.
 *
 * This is a usability measure, not a security boundary. The boundary is the
 * service re-reading the role from the database on every /admin request, which
 * stands whatever this code does. Checking here as well is what turns "every
 * panel shows a 403" into one clear sentence on the login screen — and ending
 * the session rather than merely forgetting the token means a non-administrator
 * who reached the login form does not leave an unused session behind them.
 *
 * ── Expiry ──
 *
 * The access token is refreshed shortly before it expires rather than after a
 * request has already failed. A dashboard with several panels open would
 * otherwise discover the expiry as four simultaneous 401s; the client
 * deduplicates those, but not failing in the first place is better than
 * recovering well. The reactive path in client.js stays as the safety net for a
 * token that expires while the tab is asleep and the timer never fires.
 */

const AuthContext = createContext(null);

/** Refresh this long before the access token actually expires. */
const REFRESH_MARGIN_SECONDS = 60;

/** The sign-in flow, which is three steps and not always three. */
export const STEP = {
  PHONE: 'phone',          // asking for the number
  CODE: 'code',            // code sent, waiting for it
  STEP_UP: 'step_up',      // the risk engine wants a second code
};

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [step, setStep] = useState(STEP.PHONE);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // The number under verification is rendered (the login screen masks it back
  // to the administrator to confirm they typed the right one), so it is state.
  const [phoneNumber, setPhoneNumber] = useState(null);

  // The challenge id is never rendered — it only has to survive between two
  // event handlers — so it stays in a ref and causes no re-render.
  const challengeId = useRef(null);
  const refreshTimer = useRef(null);

  const stopRefreshTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
  }, []);

  const scheduleRefresh = useCallback((expiresIn) => {
    stopRefreshTimer();
    const seconds = Number(expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) return;

    // Never schedule in the past, and never busy-loop on a very short token.
    const delay = Math.max(seconds - REFRESH_MARGIN_SECONDS, 15) * 1000;
    refreshTimer.current = setTimeout(async () => {
      try {
        const tokens = await refreshSession();
        scheduleRefresh(tokens.expiresIn);
      } catch {
        // The reactive path in client.js announces the loss; nothing to add.
      }
    }, delay);
  }, [stopRefreshTimer]);

  /** Give up the local session. `tellService` is false when it is already gone. */
  const endSession = useCallback(async ({ tellService = true, message = null } = {}) => {
    stopRefreshTimer();
    if (tellService) {
      // Logging out server-side is what drops the Redis entry, so the token
      // stops working immediately rather than when it expires. A failure here
      // must not trap the administrator in a session they asked to leave, so
      // the local state is cleared either way.
      try { await authApi.logout(); } catch { /* already gone, or unreachable */ }
    }
    clearTokens();
    setAdmin(null);
    setStep(STEP.PHONE);
    setError(null);
    setNotice(message);
    setPhoneNumber(null);
    challengeId.current = null;
  }, [stopRefreshTimer]);

  // The service, or another administrator, can end this session at any moment.
  useEffect(() => onSessionLost((reason) => {
    stopRefreshTimer();
    setAdmin(null);
    setStep(STEP.PHONE);
    setNotice(
      reason === 'flagged'
        ? 'This session was ended because of unusual activity. Please sign in again.'
        : 'Your session has ended. Please sign in again.'
    );
  }), [stopRefreshTimer]);

  useEffect(() => stopRefreshTimer, [stopRefreshTimer]);

  /**
   * Finish signing in: confirm the role, then keep the session.
   *
   * Returns nothing and throws nothing — the outcome is in the state it sets,
   * because every caller is an event handler.
   */
  const establish = useCallback(async (tokens) => {
    setTokens(tokens);
    let profile;
    try {
      profile = await authApi.me();
    } catch (err) {
      clearTokens();
      setError(err instanceof ApiError ? err.message : 'Could not confirm your account.');
      return;
    }

    if (profile.role !== 'administrator') {
      // Signed in successfully, but not to this application.
      try { await authApi.logout(); } catch { /* best effort */ }
      clearTokens();
      setError('This console is for administrator accounts. Your account does not have access to it.');
      setStep(STEP.PHONE);
      setPhoneNumber(null);
      challengeId.current = null;
      return;
    }

    scheduleRefresh(tokens.expiresIn);
    setAdmin(profile);
    setError(null);
    setNotice(null);
    setStep(STEP.PHONE);
  }, [scheduleRefresh]);

  /** Step one: ask the service to send a code to this number. */
  const requestCode = useCallback(async (number) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await authApi.requestCode(number);
      setPhoneNumber(number);
      setStep(STEP.CODE);
      // The service answers identically whether or not the number is
      // registered, so it cannot be used to discover which numbers exist. The
      // wording here has to match that: it says what was done, not that an
      // account was found.
      setNotice('If that number belongs to an account, a six-digit code is on its way. It expires in five minutes.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send a code. Please try again.');
    } finally {
      setPending(false);
    }
  }, []);

  /** Step two: submit the code. May lead to step three. */
  const submitCode = useCallback(async (otp) => {
    setPending(true);
    setError(null);
    try {
      const result = await authApi.verifyLogin({
        phoneNumber,
        otp,
        deviceFingerprint: getDeviceId(),
      });

      if (result.status === 'step_up_required') {
        challengeId.current = result.challengeId;
        setStep(STEP.STEP_UP);
        setNotice(result.message || 'We need to verify this sign-in. Enter the code we just sent.');
        return;
      }
      await establish(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify that code.');
      // A blocked sign-in is the end of this attempt, not a retryable code
      // entry: the account may now be frozen, and re-entering the code would
      // only produce the same refusal.
      if (err instanceof ApiError && err.code === 'LOGIN_BLOCKED') {
        setStep(STEP.PHONE);
        setPhoneNumber(null);
        challengeId.current = null;
      }
    } finally {
      setPending(false);
    }
  }, [establish, phoneNumber]);

  /** Step three: the step-up challenge the risk engine asked for. */
  const submitStepUp = useCallback(async (otp) => {
    setPending(true);
    setError(null);
    try {
      const tokens = await authApi.verifyStepUp({
        challengeId: challengeId.current,
        otp,
        trustDevice: true,
        deviceLabel: getDeviceLabel(),
      });
      await establish(tokens);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify that code.');
    } finally {
      setPending(false);
    }
  }, [establish]);

  /** Abandon a part-finished sign-in and go back to the number. */
  const restart = useCallback(() => {
    setPhoneNumber(null);
    challengeId.current = null;
    setStep(STEP.PHONE);
    setError(null);
    setNotice(null);
  }, []);

  const value = useMemo(() => ({
    admin,
    isAuthenticated: Boolean(admin),
    step,
    pending,
    error,
    notice,
    phoneNumber,
    requestCode,
    submitCode,
    submitStepUp,
    restart,
    logout: () => endSession({ tellService: true }),
    endSession,
  }), [admin, step, pending, error, notice, phoneNumber,
       requestCode, submitCode, submitStepUp, restart, endSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
