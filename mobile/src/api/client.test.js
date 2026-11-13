import { api, ApiError, __resetForTests as resetClient } from './client';
import * as session from '../auth/session';

/*
 * The refresh interceptor.
 *
 * This is the part of issue #42 with the most ways to be subtly wrong, and the
 * failures are the kind nobody reproduces by hand: they need a token to expire
 * at the moment two screens are both loading, or a refresh to be refused while
 * the phone is on a dying connection. So they are tested here rather than
 * discovered later.
 *
 * The four properties that matter:
 *   - one refresh at a time, however many requests hit a 401 together
 *   - a refused refresh signs the person out, with a reason
 *   - a network failure during a refresh does NOT sign them out
 *   - a session the service deliberately ended is not refreshed at all
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

/** A fetch result shaped the way client.js reads it. */
const reply = (status, body = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

/** The Authorization header of the nth fetch call, if any. */
const authHeaderOf = (callIndex) =>
  global.fetch.mock.calls[callIndex]?.[1]?.headers?.Authorization;

const pathsCalled = () =>
  global.fetch.mock.calls.map(([url]) => String(url).replace(/^https?:\/\/[^/]+/, ''));

beforeEach(async () => {
  jest.clearAllMocks();
  resetClient();
  session.__resetForTests();
  global.fetch = jest.fn();
  await session.save({ accessToken: 'access-1', refreshToken: 'refresh-1', user: { id: 'u1' } });
});

describe('attaching the token', () => {
  it('sends the access token with an authenticated request', async () => {
    global.fetch.mockResolvedValueOnce(reply(200, { id: 'u1' }));

    await expect(api.authed.get('/auth/me')).resolves.toEqual({ id: 'u1' });
    expect(authHeaderOf(0)).toBe('Bearer access-1');
  });

  it('sends no token on an unauthenticated call', async () => {
    global.fetch.mockResolvedValueOnce(reply(200, { message: 'sent' }));

    await api.post('/auth/otp/request', { phoneNumber: '+254712345678', purpose: 'login' });
    expect(authHeaderOf(0)).toBeUndefined();
  });
});

describe('refreshing on a 401', () => {
  it('refreshes and retries the original request with the new token', async () => {
    global.fetch
      .mockResolvedValueOnce(reply(401, { error: 'Access token expired', code: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(reply(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(reply(200, { id: 'u1' }));

    await expect(api.authed.get('/auth/me')).resolves.toEqual({ id: 'u1' });

    expect(pathsCalled()).toEqual(['/auth/me', '/auth/refresh', '/auth/me']);
    // The retry carries the new token, not the one that had just expired.
    expect(authHeaderOf(2)).toBe('Bearer access-2');
    // And the rotated pair is what a later request will use.
    expect(session.getAccessToken()).toBe('access-2');
    expect(session.getRefreshToken()).toBe('refresh-2');
  });

  it('keeps the stored profile across a refresh', async () => {
    // The refresh endpoint answers with tokens only. Overwriting the stored
    // user with that response would leave an offline launch nothing to show.
    global.fetch
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(reply(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(reply(200, {}));

    await api.authed.get('/auth/me');
    expect(session.getStoredUser()).toEqual({ id: 'u1' });
  });

  it('runs one refresh for several requests that expire together', async () => {
    /*
     * The case this guards is not hypothetical: the service rotates the
     * refresh token on every use, as a compare-and-swap. Two refreshes mean
     * the second presents a token that no longer exists, and the person is
     * signed out in the middle of a working session.
     */
    global.fetch.mockImplementation(async (url) => {
      const path = String(url);
      if (path.endsWith('/auth/refresh')) {
        return reply(200, { accessToken: 'access-2', refreshToken: 'refresh-2' });
      }
      // Every first attempt is unauthorized; anything bearing the new token works.
      return reply(401, { code: 'TOKEN_EXPIRED' });
    });

    // Three screens loading at once, all with the same expired token.
    const results = await Promise.allSettled([
      api.authed.get('/auth/me'),
      api.authed.get('/auth/devices'),
      api.authed.get('/auth/notifications'),
    ]);

    const refreshCalls = pathsCalled().filter((p) => p === '/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
    // All three were retried (and here all three 401 again, which is the mock,
    // not the point): what matters is that one refresh served all of them.
    expect(results).toHaveLength(3);
  });

  it('does not retry more than once', async () => {
    global.fetch
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(reply(200, { accessToken: 'access-2', refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED' }));

    await expect(api.authed.get('/auth/me')).rejects.toBeInstanceOf(ApiError);
    // Four calls would mean a second refresh, which is the start of a loop
    // that empties the rate limit and drains the battery.
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

describe('when the session is really over', () => {
  it('signs the person out when the refresh is refused', async () => {
    const lost = jest.fn();
    session.onSessionLost(lost);

    global.fetch
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED' }))
      .mockResolvedValueOnce(reply(401, { error: 'Session expired. Please log in again.', code: 'REFRESH_INVALID' }));

    await expect(api.authed.get('/auth/me')).rejects.toBeInstanceOf(ApiError);

    expect(session.hasSession()).toBe(false);
    expect(lost).toHaveBeenCalledWith('Your session expired. Please sign in again.');
  });

  it('does not try to refresh a session the risk engine flagged', async () => {
    const lost = jest.fn();
    session.onSessionLost(lost);

    global.fetch.mockResolvedValueOnce(reply(401, {
      error: 'This session was ended because of unusual activity. Please sign in again.',
      code: 'SESSION_FLAGGED',
    }));

    await expect(api.authed.get('/auth/me')).rejects.toMatchObject({ code: 'SESSION_FLAGGED' });

    // Refreshing would be asking the service to undo a decision it just made.
    expect(pathsCalled()).toEqual(['/auth/me']);
    expect(session.hasSession()).toBe(false);
    // And the reason survives to the sign-in screen, because "you were signed
    // out" with no explanation reads like a bug rather than a warning.
    expect(lost).toHaveBeenCalledWith(expect.stringContaining('unusual activity'));
  });

  it('signs the person out when the account itself is restricted', async () => {
    const lost = jest.fn();
    session.onSessionLost(lost);

    global.fetch.mockResolvedValueOnce(reply(403, {
      error: 'This account is not available. Please contact support.',
      code: 'ACCOUNT_RESTRICTED',
    }));

    await expect(api.authed.get('/auth/me')).rejects.toMatchObject({ status: 403 });
    expect(session.hasSession()).toBe(false);
    expect(lost).toHaveBeenCalledWith('This account is not available. Please contact support.');
  });
});

describe('when the network is the problem', () => {
  it('keeps the session when a refresh cannot be delivered', async () => {
    /*
     * The distinction that decides whether someone who walked into a lift
     * comes back to the screen they were on or to the sign-in form. Only an
     * answer from the service ends a session; silence does not.
     */
    const lost = jest.fn();
    session.onSessionLost(lost);

    global.fetch
      .mockResolvedValueOnce(reply(401, { code: 'TOKEN_EXPIRED' }))
      .mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(api.authed.get('/auth/me')).rejects.toMatchObject({ code: 'NETWORK' });

    expect(session.hasSession()).toBe(true);
    expect(session.getRefreshToken()).toBe('refresh-1');
    expect(lost).not.toHaveBeenCalled();
  });

  it('reports a 429 without touching the session', async () => {
    const lost = jest.fn();
    session.onSessionLost(lost);

    global.fetch.mockResolvedValueOnce(reply(429, {
      error: 'Too many requests from this device. Please try again later.',
    }));

    await expect(api.authed.get('/auth/me')).rejects.toMatchObject({ status: 429 });
    expect(session.hasSession()).toBe(true);
    expect(lost).not.toHaveBeenCalled();
  });
});
