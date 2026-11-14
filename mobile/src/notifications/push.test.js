import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { getPushToken, registerPush, unregisterPush, hasAskedBefore } from './push';
import { account } from '../api/endpoints';

/*
 * Item 4 of issue #46: register for a push token and send it to the backend.
 *
 * Most of what can happen here is a normal refusal -- an emulator, a person
 * saying no, a build with no push credentials -- and the tests hold each one
 * to a status the Settings screen can put into words, rather than an
 * exception or a switch that claims "on" while nothing will ever arrive.
 */

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED: 'whenUnlocked',
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k) => { store.delete(k); }),
    __store: store,
  };
});

jest.mock('../api/endpoints', () => ({
  account: { registerPushToken: jest.fn(), unregisterPushToken: jest.fn() },
}));

const SecureStore = require('expo-secure-store');

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.__store.clear();
  Device.isDevice = true;
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
  Notifications.getDevicePushTokenAsync.mockResolvedValue({ data: 'fcm-token-xyz' });
  account.registerPushToken.mockResolvedValue({ registered: true });
  account.unregisterPushToken.mockResolvedValue({ registered: false });
  Constants.expoConfig.extra = { ...(Constants.expoConfig.extra || {}), eas: undefined };
});

describe('getting a token', () => {
  it('reports an emulator as unsupported, without asking anything', async () => {
    Device.isDevice = false;
    await expect(getPushToken({ ask: true })).resolves.toEqual({ status: 'unsupported' });
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not ask unless told to', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    await expect(getPushToken({ ask: false })).resolves.toEqual({ status: 'denied' });
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks when told to, and remembers that it has', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    expect(await hasAskedBefore()).toBe(false);

    await getPushToken({ ask: true });

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(await hasAskedBefore()).toBe(true);
  });

  it('respects a no', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(getPushToken({ ask: true })).resolves.toEqual({ status: 'denied' });
  });

  it('uses an Expo push token when the project has an EAS id', async () => {
    Constants.expoConfig.extra = { ...Constants.expoConfig.extra, eas: { projectId: 'proj-123' } };
    const result = await getPushToken();
    expect(result).toEqual({ status: 'granted', token: 'ExponentPushToken[abc]', provider: 'expo' });
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
  });

  it('falls back to the device token, and says which kind', async () => {
    const result = await getPushToken();
    expect(result.token).toBe('fcm-token-xyz');
    expect(['fcm', 'apns']).toContain(result.provider);
  });

  it('reports a platform that will not issue a token as unavailable, not as an error', async () => {
    Notifications.getDevicePushTokenAsync.mockRejectedValue(new Error('No Google Play services'));
    await expect(getPushToken()).resolves.toMatchObject({ status: 'unavailable' });
  });
});

describe('registering with the service', () => {
  it('sends the token, its kind and the platform', async () => {
    await expect(registerPush()).resolves.toEqual({ status: 'on' });
    expect(account.registerPushToken).toHaveBeenCalledWith(expect.objectContaining({
      token: 'fcm-token-xyz', provider: expect.any(String), platform: expect.stringMatching(/ios|android/),
    }));
  });

  it('says unavailable rather than "on" when the service cannot be reached', async () => {
    account.registerPushToken.mockRejectedValue(new Error('offline'));
    await expect(registerPush()).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('sends nothing when there is no permission', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(registerPush()).resolves.toMatchObject({ status: 'denied' });
    expect(account.registerPushToken).not.toHaveBeenCalled();
  });
});

describe('switching off', () => {
  it('tells the service which token to forget', async () => {
    await registerPush();
    await expect(unregisterPush()).resolves.toEqual({ status: 'off' });
    expect(account.unregisterPushToken).toHaveBeenCalledWith('fcm-token-xyz');
  });

  it('never throws, even offline', async () => {
    await registerPush();
    account.unregisterPushToken.mockRejectedValue(new Error('offline'));
    await expect(unregisterPush()).resolves.toEqual({ status: 'off' });
  });
});
