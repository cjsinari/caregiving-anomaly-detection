import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { account } from '../api/endpoints';

/*
 * Getting a push address for this phone and handing it to the service (#46).
 *
 * ── Every way this can fail is a normal day ──
 *
 * An emulator has no push address. A person may say no to the permission
 * prompt, and on Android 13+ that prompt is a real choice they are entitled to
 * make. A development build without an EAS project id cannot get an Expo push
 * token. None of these is an error the app should crash on, or quietly
 * swallow so that the Settings switch says "on" while nothing will ever
 * arrive. So every function here answers with a status the Settings screen
 * can put into words:
 *
 *   on           registered with the service
 *   denied       the person said no; only system settings can undo that
 *   unsupported  an emulator or simulator
 *   unavailable  the platform would not issue a token (no project id, no
 *                Google Play services, a network failure)
 *   off          the person switched pushes off in the app
 *
 * ── Which token ──
 *
 * An Expo push token when the app has an EAS project id configured (expo.extra
 * .eas.projectId, set when the project is linked with `eas init`), because
 * that is what the Expo push service sends to. Without one, the device's own
 * FCM or APNs token, which a server can send to directly. The service is told
 * which kind it has (`provider`) so a future sender does not have to guess.
 *
 * ── Remembered, so it can be withdrawn ──
 *
 * The token is kept in the keychain so switching pushes off can tell the
 * service exactly which address to stop using. Signing out does not need it:
 * the service revokes every token registered under the session that ends.
 */

const TOKEN_KEY = 'lindacare.push.v1';
const ASKED_KEY = 'lindacare.push.asked.v1';
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED };

/*
 * How a push is shown when it arrives while the app is open. A banner and a
 * sound -- a family member with the app open is not less entitled to hear
 * that their mother fell -- and no app-icon badge count, which on One UI
 * lingers long after the thing it counted has been read.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  // One channel, named for what it carries, so it is recognisable in the
  // phone's own notification settings among every other app's.
  await Notifications.setNotificationChannelAsync('care', {
    name: 'Care updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
  });
}

/** Has the app already asked once? It asks once and never nags. */
export async function hasAskedBefore() {
  try {
    return (await SecureStore.getItemAsync(ASKED_KEY, OPTIONS)) === '1';
  } catch {
    return false;
  }
}

/**
 * Get this device's push token, asking for permission only if `ask` is set.
 * Never throws; see the statuses above.
 */
export async function getPushToken({ ask = false } = {}) {
  if (!Device.isDevice) return { status: 'unsupported' };

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && ask) {
    try { await SecureStore.setItemAsync(ASKED_KEY, '1', OPTIONS); } catch { /* best effort */ }
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return { status: 'denied' };

  try {
    await ensureAndroidChannel();
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (projectId) {
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
      return { status: 'granted', token: data, provider: 'expo' };
    }
    const { data } = await Notifications.getDevicePushTokenAsync();
    return {
      status: 'granted',
      token: String(data),
      provider: Platform.OS === 'ios' ? 'apns' : 'fcm',
    };
  } catch (err) {
    return { status: 'unavailable', reason: err?.message || 'No push token was issued' };
  }
}

/**
 * Register this device with the service. Returns `{ status }`.
 *
 * A failure to *reach* the service is reported as `unavailable` rather than
 * thrown: the Settings switch then says pushes could not be set up, and the
 * next launch tries again.
 */
export async function registerPush({ ask = false } = {}) {
  const result = await getPushToken({ ask });
  if (result.status !== 'granted') return { status: result.status, reason: result.reason };

  try {
    await account.registerPushToken({
      token: result.token,
      provider: result.provider,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch (err) {
    return { status: 'unavailable', reason: err?.message };
  }
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, result.token, OPTIONS);
  } catch { /* the service has it; only switching off needs the local copy */ }
  return { status: 'on' };
}

/** Tell the service to stop pushing to this device. Best effort, never throws. */
export async function unregisterPush() {
  let token = null;
  try { token = await SecureStore.getItemAsync(TOKEN_KEY, OPTIONS); } catch { /* none */ }
  if (token) {
    try { await account.unregisterPushToken(token); } catch { /* retried on the next switch-off */ }
  }
  try { await SecureStore.deleteItemAsync(TOKEN_KEY, OPTIONS); } catch { /* nothing to do */ }
  return { status: 'off' };
}
