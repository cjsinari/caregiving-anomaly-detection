import * as session from './session';

/*
 * Two session behaviours #46 depends on, at the layer that does them.
 *
 *   A profile edit outlives the process. The Profile screen calls updateUser,
 *   which writes through here; a relaunch reads the keychain back, so the new
 *   name is there even on a launch with no signal.
 *
 *   The portal follows the token. getTokenRole is what AuthContext chooses the
 *   portal from, and it must read the role the service signed into the token.
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
jest.mock('expo-crypto', () => ({ randomUUID: () => 'device-under-test' }));

const SecureStore = require('expo-secure-store');

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenWith = (payload) => `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;

beforeEach(() => {
  SecureStore.__store.clear();
  session.__resetForTests();
});

describe('a profile edit survives a relaunch', () => {
  it('is in the keychain, and comes back after the process is gone', async () => {
    await session.save({
      accessToken: tokenWith({ role: 'family' }),
      refreshToken: 'r1',
      user: { id: 'u1', fullName: 'Peter Wanjiku', role: 'family' },
    });

    await session.updateStoredUser({ fullName: 'Peter Kamau Wanjiku', phoneNumber: '+254700000202' });

    // A relaunch: nothing in memory, only what the keychain kept.
    session.__resetForTests();
    expect(await session.load()).toBe(true);
    expect(session.getStoredUser()).toMatchObject({
      id: 'u1',
      fullName: 'Peter Kamau Wanjiku',
      phoneNumber: '+254700000202',
      // The edit merges; it does not wipe what it did not mention.
      role: 'family',
    });
  });

  it('does nothing when nobody is signed in', async () => {
    await session.updateStoredUser({ fullName: 'Nobody' });
    expect(SecureStore.__store.size).toBe(0);
  });
});

describe('the role the portal is chosen from', () => {
  it('is the role in the access token', async () => {
    await session.save({
      accessToken: tokenWith({ role: 'caregiver' }),
      refreshToken: 'r1',
      user: { id: 'u1', role: 'caregiver' },
    });
    expect(session.getTokenRole()).toBe('caregiver');
  });

  it('is null for a token the app cannot read, so the stored role is used instead', async () => {
    await session.save({ accessToken: 'opaque', refreshToken: 'r1', user: { id: 'u1', role: 'family' } });
    expect(session.getTokenRole()).toBeNull();
  });

  it('is null when signed out', () => {
    expect(session.getTokenRole()).toBeNull();
  });
});
