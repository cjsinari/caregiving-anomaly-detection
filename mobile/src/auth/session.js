import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/*
 * Where the session lives.
 *
 * Two jobs, deliberately kept apart from everything else: it owns the tokens
 * in memory, and it owns the one copy on disk. It makes no network calls, so
 * api/client.js can import it without a cycle -- the refresh request lives
 * there, and the tokens it rotates live here.
 *
 * ── Why expo-secure-store and not AsyncStorage ──
 *
 * AsyncStorage is an unencrypted SQLite file in the app's sandbox. On a rooted
 * or jailbroken phone, in an `adb backup`, or in a cloud backup of the device,
 * that file is readable, and a refresh token read out of it is a week of
 * someone else's account. SecureStore puts it in the iOS Keychain and in
 * Android's EncryptedSharedPreferences, keyed by the hardware-backed keystore,
 * so the ciphertext in a backup is useless without the device.
 *
 * ── Why one item and not two ──
 *
 * The access and refresh tokens are stored as a single JSON item. Two items
 * would be two writes, and a crash or a kill between them leaves an access
 * token paired with a refresh token from the previous rotation -- a session
 * that looks restorable, fails its first refresh, and signs the person out for
 * no reason they can see. One write is atomic enough to make that impossible.
 *
 * The item also carries the small user object the service returns at sign-in,
 * for one narrow purpose: a launch with no signal. See getStoredUser.
 */

const TOKENS_KEY = 'lindacare.session.v1';
const DEVICE_KEY = 'lindacare.device.v1';

// WHEN_UNLOCKED rather than the default: the tokens are only ever used while
// someone is looking at the app, and this keeps them out of reach of a
// background process on a locked phone.
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED };

/*
 * The tokens, in memory.
 *
 * Every request reads them from here, not from the keychain: a keychain read
 * is a native round trip, and the interceptor would do one per request.
 */
let tokens = null;

/** Called when the session is gone for good and the UI has to return to sign-in. */
const listeners = new Set();

/**
 * Tell the app the session has ended.
 *
 * The reason reaches the sign-in screen as a sentence, because "you were
 * signed out" with no explanation reads like a bug. A flagged session in
 * particular is something the person needs to be told about.
 */
export function onSessionLost(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitSessionLost(reason) {
  listeners.forEach((listener) => {
    try {
      listener(reason);
    } catch (err) {
      // A throwing listener must not stop the others from being told, or the
      // app is left showing protected screens with no session behind them.
      console.warn('session listener failed:', err?.message);
    }
  });
}

export function getAccessToken() {
  return tokens?.accessToken || null;
}

export function getRefreshToken() {
  return tokens?.refreshToken || null;
}

export function hasSession() {
  return Boolean(tokens?.refreshToken);
}

/**
 * The profile as it was at the last sign-in.
 *
 * Used only when the app launches with a valid session and cannot reach the
 * service to confirm it. It is a cache, never the authority: anything that
 * matters -- the account being frozen, a role change -- is enforced by the
 * service on the next request it answers, not by this copy.
 */
export function getStoredUser() {
  return tokens?.user || null;
}

/**
 * Persist a freshly issued or freshly rotated pair.
 *
 * `user` is merged rather than overwritten, because the refresh endpoint
 * answers with tokens alone. Assigning `next.user` straight across would erase
 * the stored profile on the first silent refresh, and the next offline launch
 * would have nothing to fall back on.
 */
export async function save(next) {
  tokens = {
    accessToken: next.accessToken,
    refreshToken: next.refreshToken,
    user: next.user !== undefined ? next.user : tokens?.user || null,
  };
  try {
    await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(tokens), OPTIONS);
  } catch (err) {
    /*
     * The keychain refused the write. The session still works for as long as
     * the app stays in memory, so this does not sign anyone out -- it only
     * means the session will not survive a restart. Worth a log and not worth
     * interrupting someone mid-task.
     */
    console.warn('Could not persist the session:', err?.message);
  }
}

/** Read the stored pair into memory. Returns true if there was one. */
export async function load() {
  try {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY, OPTIONS);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed?.refreshToken) return false;
    tokens = {
      accessToken: parsed.accessToken || null,
      refreshToken: parsed.refreshToken,
      user: parsed.user || null,
    };
    return true;
  } catch (err) {
    // Corrupt or undecryptable: treat it as no session rather than crashing on
    // launch, and drop it so the next launch is not the same failure again.
    console.warn('Could not read the stored session:', err?.message);
    tokens = null;
    try { await SecureStore.deleteItemAsync(TOKENS_KEY, OPTIONS); } catch { /* nothing to do */ }
    return false;
  }
}

/**
 * Forget the session.
 *
 * Memory first, disk second, and the disk failure is swallowed: whatever the
 * keychain does, this process must not keep using the tokens. `notify` is
 * false when the UI already knows -- a deliberate sign-out -- and true when
 * the session was lost underneath it.
 */
export async function clear({ notify = false, reason } = {}) {
  tokens = null;
  try {
    await SecureStore.deleteItemAsync(TOKENS_KEY, OPTIONS);
  } catch (err) {
    console.warn('Could not delete the stored session:', err?.message);
  }
  if (notify) emitSessionLost(reason);
}

/*
 * The device fingerprint the service wants with every sign-in.
 *
 * It is what device trust is keyed on: a device that has passed a step-up once
 * is remembered, so the next sign-in from it is not challenged again. That
 * only works if the value is stable, so it is generated once and kept.
 *
 * Kept under its own key, and deliberately NOT removed by clear(): signing out
 * is not the same as arriving on a new phone, and deleting it would make every
 * sign-in after a sign-out look like a brand-new device and draw a step-up
 * challenge the person has already answered.
 *
 * It does not survive reinstalling the app, because the keychain item goes with
 * it on Android. That is the right failure: a reinstall genuinely cannot be
 * distinguished from a new device, and the consequence is one extra SMS.
 */
let deviceId = null;

export async function getDeviceFingerprint() {
  if (deviceId) return deviceId;
  try {
    const stored = await SecureStore.getItemAsync(DEVICE_KEY, OPTIONS);
    if (stored) {
      deviceId = stored;
      return deviceId;
    }
  } catch (err) {
    console.warn('Could not read the device id:', err?.message);
  }

  const fresh = Crypto.randomUUID();
  try {
    await SecureStore.setItemAsync(DEVICE_KEY, fresh, OPTIONS);
  } catch (err) {
    // Unstored means the next launch generates another one and the device is
    // challenged again. Still better than sending nothing: the service
    // requires the field, so a missing value is a failed sign-in.
    console.warn('Could not persist the device id:', err?.message);
  }
  deviceId = fresh;
  return deviceId;
}

/** Test seam: drops the in-memory copies without touching the keychain. */
export function __resetForTests() {
  tokens = null;
  deviceId = null;
  listeners.clear();
}
