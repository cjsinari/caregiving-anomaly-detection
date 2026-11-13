import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { family } from '../api/family';
import { useAuth } from '../auth/AuthContext';
import useAsyncResource from '../hooks/useAsyncResource';

/*
 * The family portal's shared state: which loved one is on screen, and the
 * family member's own settings.
 *
 * ── Which loved one ──
 *
 * The service lets one family account own several care profiles -- a mother
 * and a father, say -- and every family screen is about exactly one of them.
 * Held here, above the navigator, so choosing a parent on the home screen is
 * still the choice on the schedule. Each screen holding its own would mean
 * reading Mum's care plan beside Dad's schedule, which is the one mistake this
 * portal must never invite.
 *
 * ── The family member's own settings, and why they are the only edits ──
 *
 * Issue #45 says two things that pull against each other: the loved one's
 * profile and care plan are *read-only*, and "profile edits persist after
 * relaunch". The first is explicit and is a safety rule -- care data is the
 * care team's record -- so it wins outright, and nothing about the loved
 * one's record is editable anywhere in this portal.
 *
 * What *is* the family member's to edit is how the app speaks to them:
 *
 *   - what they call their loved one ("Mum" rather than "Margaret Wanjiku"),
 *     used across every screen. A name is the first thing on every screen, and
 *     the formal one reads like a hospital letter about your own mother;
 *   - which kinds of care notification they want. Incidents and account
 *     security notices cannot be muted, on purpose;
 *   - which loved one the app opens on.
 *
 * None of these is care data and none goes to the service -- the care team
 * keeps calling her by her name. They are stored in the keychain on this
 * phone, keyed to the account, so they survive a relaunch, are not shared with
 * whoever signs in next on a shared phone, and survive a sign-out and back in.
 * Editing the account's own details (name, email) needs a service endpoint
 * that does not exist yet, and belongs with the profile screen in #46.
 */

const FamilyContext = createContext(null);

export function useFamily() {
  const value = useContext(FamilyContext);
  if (!value) throw new Error('useFamily must be used inside a FamilyProvider');
  return value;
}

/** The notification categories a family member may switch off. */
export const MUTABLE_CATEGORIES = [
  { key: 'visit', label: 'Completed visits', hint: 'A message each time a visit report is filed' },
  { key: 'note', label: 'Care notes', hint: 'Notes the care team writes between visits' },
  { key: 'schedule', label: 'Schedule changes', hint: 'Visits added, moved or cancelled' },
];

/** Never mutable: an incident and an account security notice always reach them. */
export const ALWAYS_ON = ['incident', 'account'];

const DEFAULT_PREFS = {
  nicknames: {},
  muted: {},
  selectedId: null,
};

/** Keychain keys allow [A-Za-z0-9._-]; a user id is a UUID, which fits. */
const prefsKey = (userId) => `lindacare.familyPrefs.v1.${String(userId).replace(/[^A-Za-z0-9._-]/g, '_')}`;

const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED };

export function FamilyProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id || 'anonymous';

  /* ── preferences ── */

  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const prefsRef = useRef(DEFAULT_PREFS);
  const [prefsReady, setPrefsReady] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let cancelled = false;
    setPrefsReady(false);
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(prefsKey(userId), OPTIONS);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!cancelled) {
          const loaded = { ...DEFAULT_PREFS, ...(parsed || {}) };
          prefsRef.current = loaded;
          setPrefs(loaded);
        }
      } catch {
        // Unreadable settings are not worth failing the portal over. Defaults
        // are a safe answer: nothing muted, the formal name.
        if (!cancelled) {
          prefsRef.current = DEFAULT_PREFS;
          setPrefs(DEFAULT_PREFS);
        }
      } finally {
        if (!cancelled) setPrefsReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  /*
   * Write-through on every change.
   *
   * The state updates first, so the screen never waits on the keychain. If
   * the write fails, the change still holds for this session and the screen
   * is told it will not survive a restart -- the honest version of
   * "saved", rather than a toggle that silently resets tomorrow.
   */
  /*
   * Computed from a ref, not inside a setPrefs updater. An updater is not a
   * safe place for a side effect -- React may run it late, or twice -- and the
   * keychain write here is exactly the kind of effect that must happen once,
   * with the value that was actually committed. useOptimisticTasks learned
   * this the hard way in #44.
   */
  const update = useCallback((change) => {
    const current = prefsRef.current;
    const next = typeof change === 'function' ? change(current) : { ...current, ...change };
    prefsRef.current = next;
    setPrefs(next);

    SecureStore.setItemAsync(prefsKey(userId), JSON.stringify(next), OPTIONS)
      .then(() => { if (alive.current) setSaveError(null); })
      .catch(() => {
        if (alive.current) {
          setSaveError('Saved for now, but this phone could not store it. It will reset when the app restarts.');
        }
      });
  }, [userId]);

  const setNickname = useCallback((recipientId, name) => {
    const trimmed = String(name || '').trim().slice(0, 40);
    update((current) => {
      const nicknames = { ...current.nicknames };
      if (trimmed) nicknames[recipientId] = trimmed;
      else delete nicknames[recipientId];
      return { ...current, nicknames };
    });
  }, [update]);

  const setMuted = useCallback((category, muted) => {
    if (ALWAYS_ON.includes(category)) return;
    update((current) => ({ ...current, muted: { ...current.muted, [category]: Boolean(muted) } }));
  }, [update]);

  /* ── loved ones ── */

  const load = useCallback(() => family.recipients(), []);
  const resource = useAsyncResource(load, [userId]);
  const recipients = useMemo(() => resource.data?.recipients || [], [resource.data]);

  /*
   * The selection falls back to the first loved one whenever the remembered
   * one is not on the list -- a profile deleted, an account that changed --
   * rather than rendering every screen for an id that no longer resolves.
   */
  const selected = recipients.find((r) => r.id === prefs.selectedId) || recipients[0] || null;

  const select = useCallback((recipientId) => update({ selectedId: recipientId }), [update]);

  /** The name the app uses for a loved one: theirs if they set one. */
  const displayName = useCallback((recipient) => {
    if (!recipient) return '';
    return prefs.nicknames[recipient.id] || recipient.fullName;
  }, [prefs.nicknames]);

  const isMuted = useCallback(
    (category) => !ALWAYS_ON.includes(category) && Boolean(prefs.muted[category]),
    [prefs.muted]
  );

  const value = useMemo(() => ({
    recipients,
    selected,
    select,
    status: resource.status,
    error: resource.error,
    reload: resource.reload,
    prefs,
    prefsReady,
    saveError,
    setNickname,
    setMuted,
    isMuted,
    displayName,
  }), [recipients, selected, select, resource.status, resource.error, resource.reload,
    prefs, prefsReady, saveError, setNickname, setMuted, isMuted, displayName]);

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

/** Test seam: the key a given account's settings live under. */
export const __prefsKeyForTests = prefsKey;
