/*
 * Native modules every suite would otherwise have to mock by hand.
 *
 * expo-notifications registers a handler the moment it is imported
 * (src/notifications/push.js), and its native half does not exist under Jest,
 * so any test that renders a signed-in portal would crash at import. Mocked
 * here once, as an emulator with no permission granted: the push code then
 * takes its "unsupported" path and makes no request, which is what every
 * screen test wants. push.test.js overrides these to drive the real cases.
 */
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-token]' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ data: 'device-token-test' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  AndroidImportance: { HIGH: 4 },
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-device', () => ({ isDevice: false }));
