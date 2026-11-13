import { Text, View } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import { AuthProvider, useAuth } from './AuthContext';
import * as session from './session';
import { auth } from '../api/endpoints';
import { ApiError } from '../api/client';

/*
 * Session restore, sign-in and sign-out.
 *
 * The behaviour worth pinning here is what happens at launch, because it is
 * the one the person never asked for and always notices: a caregiver opening
 * the app on a matatu with no signal must not be signed out, and someone whose
 * session was revoked overnight must not be shown the app for a second first.
 */

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED: 'whenUnlocked',
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => { store.set(key, value); }),
    deleteItemAsync: jest.fn(async (key) => { store.delete(key); }),
    __store: store,
  };
});

jest.mock('expo-crypto', () => ({ randomUUID: () => 'device-under-test' }));

jest.mock('../api/endpoints', () => ({
  auth: { me: jest.fn(), logout: jest.fn() },
}));

const SecureStore = require('expo-secure-store');

/*
 * The context as the app sees it.
 *
 * State is read through rendered text, and the callbacks are captured into
 * `ctx` so a test can sign out the way a button would. Reaching for the
 * context object directly keeps these tests about the provider rather than
 * about a fake screen built to drive it.
 */
let ctx = null;

function Probe() {
  ctx = useAuth();
  const { status, user, notice } = ctx;
  return (
    <View>
      <Text testID="status">{status}</Text>
      <Text testID="user">{user?.fullName || 'none'}</Text>
      <Text testID="notice">{notice || 'none'}</Text>
    </View>
  );
}

let screen;

const renderProvider = async () => {
  screen = await render(<AuthProvider><Probe /></AuthProvider>);
  return screen;
};

const valueOf = (testID) => screen.getByTestId(testID).props.children;

/** Put a session in the keychain, as a previous launch would have left it. */
const storeSession = (user) => {
  SecureStore.__store.set('lindacare.session.v1', JSON.stringify({
    accessToken: 'access-1', refreshToken: 'refresh-1', user,
  }));
};

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.__store.clear();
  session.__resetForTests();
  ctx = null;
});

describe('restoring on launch', () => {
  it('starts signed out when there is nothing stored', async () => {
    await renderProvider();

    await waitFor(() => expect(valueOf('status')).toBe('signedOut'));
    // Nothing stored means nothing to confirm: the service is not called at all.
    expect(auth.me).not.toHaveBeenCalled();
  });

  it('confirms a stored session with the service and signs in', async () => {
    storeSession({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.me.mockResolvedValue({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });

    await renderProvider();

    await waitFor(() => expect(valueOf('status')).toBe('signedIn'));
    expect(valueOf('user')).toBe('Jane Kamau');
    expect(auth.me).toHaveBeenCalledTimes(1);
  });

  it('prefers what the service says over the stored copy', async () => {
    // The cached profile is a cache. A name or a role changed elsewhere has to
    // win, or the app shows stale facts about the account indefinitely.
    storeSession({ id: 'u1', fullName: 'Jane Kamau', role: 'family' });
    auth.me.mockResolvedValue({ id: 'u1', fullName: 'Jane W. Kamau', role: 'caregiver' });

    await renderProvider();

    await waitFor(() => expect(valueOf('user')).toBe('Jane W. Kamau'));
  });

  it('stays signed in on a launch with no connection', async () => {
    /*
     * The tokens are still valid; the phone simply could not reach the
     * service. Signing someone out here would mean an app that works only
     * where there is signal, in a country where that is not a safe
     * assumption.
     */
    storeSession({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.me.mockRejectedValue(new ApiError('Could not reach LindaCare.', { code: 'NETWORK' }));

    await renderProvider();

    await waitFor(() => expect(valueOf('status')).toBe('signedIn'));
    expect(valueOf('user')).toBe('Jane Kamau');
  });

  it('signs out when the service refuses the stored session', async () => {
    // A real answer, unlike a network failure, is authoritative.
    storeSession({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.me.mockRejectedValue(new ApiError('Session expired. Please log in again.',
      { status: 401, code: 'REFRESH_INVALID' }));

    await renderProvider();

    await waitFor(() => expect(valueOf('status')).toBe('signedOut'));
    expect(valueOf('user')).toBe('none');
  });

  it('signs out when there is no cached profile to fall back on', async () => {
    // An older install, or a keychain item written before the profile was
    // kept. Showing the app with no idea whose it is would be worse.
    storeSession(null);
    auth.me.mockRejectedValue(new ApiError('Could not reach LindaCare.', { code: 'NETWORK' }));

    await renderProvider();

    await waitFor(() => expect(valueOf('status')).toBe('signedOut'));
  });
});

describe('losing the session while signed in', () => {
  it('shows why, rather than silently returning to sign-in', async () => {
    storeSession({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.me.mockResolvedValue({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });

    await renderProvider();
    await waitFor(() => expect(valueOf('status')).toBe('signedIn'));

    // What api/client.js does when the risk engine flags the session.
    await act(async () => {
      await session.clear({
        notify: true,
        reason: 'We ended your session because of unusual activity on your account. Please sign in again.',
      });
    });

    await waitFor(() => expect(valueOf('status')).toBe('signedOut'));
    expect(valueOf('notice')).toContain('unusual activity');
    expect(valueOf('user')).toBe('none');
  });
});

describe('signing out', () => {
  it('revokes on the service, then clears the keychain', async () => {
    storeSession({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.me.mockResolvedValue({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.logout.mockResolvedValue({ message: 'Logged out.' });

    await renderProvider();
    await waitFor(() => expect(valueOf('status')).toBe('signedIn'));

    await act(async () => { await ctx.signOut(); });

    await waitFor(() => expect(valueOf('status')).toBe('signedOut'));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(session.hasSession()).toBe(false);
    expect(SecureStore.__store.has('lindacare.session.v1')).toBe(false);
  });

  it('still signs out locally when the revoke call fails', async () => {
    /*
     * No signal, or an access token the service already stopped accepting.
     * Leaving someone signed in because the network was down is the worst
     * reading of "logout failed", particularly on a shared phone.
     */
    storeSession({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.me.mockResolvedValue({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.logout.mockRejectedValue(new ApiError('Could not reach LindaCare.', { code: 'NETWORK' }));

    await renderProvider();
    await waitFor(() => expect(valueOf('status')).toBe('signedIn'));

    await act(async () => { await ctx.signOut(); });

    await waitFor(() => expect(valueOf('status')).toBe('signedOut'));
    expect(session.hasSession()).toBe(false);
  });

  it('keeps the device fingerprint, so the next sign-in is not challenged again', async () => {
    // Signing out is not the same as arriving on a new phone. Dropping the
    // fingerprint would draw a step-up challenge the person already answered.
    storeSession({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.me.mockResolvedValue({ id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' });
    auth.logout.mockResolvedValue({});

    const fingerprint = await session.getDeviceFingerprint();

    await renderProvider();
    await waitFor(() => expect(valueOf('status')).toBe('signedIn'));

    await act(async () => { await ctx.signOut(); });

    session.__resetForTests();
    await expect(session.getDeviceFingerprint()).resolves.toBe(fingerprint);
  });
});
