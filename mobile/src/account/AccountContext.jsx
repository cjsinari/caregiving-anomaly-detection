import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { account, auth } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { hasAskedBefore, registerPush, unregisterPush } from '../notifications/push';

/*
 * The signed-in person's notification settings and push registration, shared
 * by both portals (#46).
 *
 * ── On the service, cached on the phone ──
 *
 * Which pushes someone wants has to live on the service, because whatever
 * sends pushes runs there and has to read it. It is cached in the keychain as
 * well, so the Settings screen on an offline launch shows the person's own
 * choices rather than a row of spinners, and so the family notification list
 * can honour a muted category before the network answers.
 *
 * This replaces the device-only "notify me about" switches #45 kept on the
 * care plan screen. Those only filtered the in-app list; a push sender could
 * never have seen them. There is now one set of choices, in Settings, and both
 * the push sender and the in-app list obey it.
 *
 * ── What can never be muted is decided by the service ──
 *
 * The categories and the always-on list come from GET /auth/me/preferences.
 * The app does not keep its own copy of which kinds are mutable, so it cannot
 * offer a switch the service would refuse, or forget to offer one it accepts.
 *
 * ── Toggles are optimistic, and roll back ──
 *
 * The switch moves on the tap. If the service refuses or cannot be reached, it
 * moves back and the screen says why -- the same shape as ticking a task in
 * #44, for the same reason: a switch that waits a second to move feels broken,
 * and one that moves and silently does not save is worse.
 */

const AccountContext = createContext(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside an AccountProvider');
  return value;
}

/*
 * A floor under the service's always-on list, held in the app itself.
 *
 * The service decides what is mutable, and the app shows its answer. But the
 * in-app list also reads the *cached* answer, from the keychain, on a launch
 * with no signal -- and a cached value is a value something else could have
 * written: a corrupted item, a future version's format, a rooted phone. Whatever
 * it says, an incident and an account security notice are never hidden here.
 */
export const NEVER_MUTED = ['incident', 'account'];

const cacheKey = (userId) => `lindacare.prefs.v1.${String(userId).replace(/[^A-Za-z0-9._-]/g, '_')}`;
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED };

export function AccountProvider({ children }) {
  const { user, updateUser } = useAuth();
  const userId = user?.id || 'anonymous';

  const [prefs, setPrefs] = useState(null);
  const prefsRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [pushStatus, setPushStatus] = useState('pending');
  // Set once this device is registered for this account in this run, so the
  // launch effect and the Settings switch do not both register it.
  const registered = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const commit = useCallback((next) => {
    prefsRef.current = next;
    setPrefs(next);
    SecureStore.setItemAsync(cacheKey(userId), JSON.stringify(next), OPTIONS).catch(() => {});
  }, [userId]);

  /* ── load: cache first, then the service ── */

  const load = useCallback(async () => {
    setError(null);
    try {
      const raw = await SecureStore.getItemAsync(cacheKey(userId), OPTIONS);
      if (raw && alive.current && !prefsRef.current) {
        const cached = JSON.parse(raw);
        prefsRef.current = cached;
        setPrefs(cached);
        setStatus('ready');
      }
    } catch { /* no cache is fine */ }

    try {
      const { preferences } = await account.getPreferences();
      if (!alive.current) return;
      commit(preferences);
      setStatus('ready');
    } catch (err) {
      if (!alive.current) return;
      setError(err);
      // With a cache on screen this is a stale-but-usable state, not a failure.
      setStatus(prefsRef.current ? 'ready' : 'error');
    }
  }, [userId, commit]);

  useEffect(() => { load(); }, [load]);

  /*
   * The full profile, once per sign-in.
   *
   * Sign-in answers with a small user object -- id, name, role -- and no phone
   * number or email, which the Account and Profile screens show. One read of
   * /auth/me fills those in. The role is deliberately left out of the merge:
   * which portal is mounted follows the access token's claim (AuthContext),
   * and letting this read change it would make a role change take effect on
   * an arbitrary request rather than on the next token refresh.
   */
  useEffect(() => {
    if (!user?.id) return;
    auth.me()
      .then(({ role: _ignored, ...fresh }) => { if (alive.current) updateUser(fresh); })
      .catch(() => { /* the cached profile stands; nothing here is urgent */ });
    // Once per account, not on every profile change it causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* ── push: register on sign-in, ask once ── */

  useEffect(() => {
    if (!prefs) return undefined;
    let cancelled = false;
    (async () => {
      if (prefs.push === false) {
        registered.current = false;
        setPushStatus('off');
        return;
      }
      if (registered.current) return;
      /*
       * Ask for permission once, the first time someone signs in, and never
       * again on our own initiative: after a "no" only the person can change
       * their mind, from the switch in Settings. Asking on every launch is how
       * an app teaches people to deny everything it asks for.
       */
      const ask = !(await hasAskedBefore());
      const result = await registerPush({ ask });
      if (result.status === 'on') registered.current = true;
      if (!cancelled && alive.current) setPushStatus(result.status);
    })();
    return () => { cancelled = true; };
    // Only when the push choice itself changes, not on every category toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs?.push, userId]);

  /* ── changes ── */

  const setCategory = useCallback(async (key, enabled) => {
    const before = prefsRef.current;
    if (!before) return;
    setSaveError(null);
    commit({
      ...before,
      categories: before.categories.map((c) => (c.key === key ? { ...c, enabled } : c)),
    });
    try {
      const { preferences } = await account.updatePreferences({ categories: { [key]: enabled } });
      if (alive.current) commit(preferences);
    } catch (err) {
      if (!alive.current) return;
      commit(before);
      setSaveError(err?.message || 'That change was not saved. Please try again.');
    }
  }, [commit]);

  /**
   * Switch pushes on or off for this account.
   *
   * Switching on is the one moment the app asks again for permission, because
   * the person has just asked for exactly that. If they still refuse, the
   * switch stays off and the screen says where the setting really lives.
   */
  const setPush = useCallback(async (enabled) => {
    const before = prefsRef.current;
    if (!before) return { status: pushStatus };
    setSaveError(null);

    if (enabled) {
      const result = await registerPush({ ask: true });
      if (!alive.current) return result;
      setPushStatus(result.status);
      if (result.status !== 'on') return result;
      registered.current = true;
    } else {
      registered.current = false;
      await unregisterPush();
      if (alive.current) setPushStatus('off');
    }

    commit({ ...before, push: enabled });
    try {
      const { preferences } = await account.updatePreferences({ push: enabled });
      if (alive.current) commit(preferences);
    } catch (err) {
      if (!alive.current) return { status: 'error' };
      commit(before);
      setSaveError(err?.message || 'That change was not saved. Please try again.');
    }
    return { status: enabled ? 'on' : 'off' };
  }, [commit, pushStatus]);

  /** Is a category switched off? Never true for an always-on one. */
  const isMuted = useCallback((key) => {
    if (!prefs) return false;
    if (NEVER_MUTED.includes(key) || (prefs.alwaysOn || []).includes(key)) return false;
    const category = (prefs.categories || []).find((c) => c.key === key);
    return category ? category.enabled === false : false;
  }, [prefs]);

  const value = useMemo(() => ({
    prefs, status, error, saveError, pushStatus,
    reload: load, setCategory, setPush, isMuted,
  }), [prefs, status, error, saveError, pushStatus, load, setCategory, setPush, isMuted]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
