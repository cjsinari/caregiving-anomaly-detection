import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { stubFetch, streamStub } from './harness';

/*
 * Hardening, and the hooks the dashboard's behaviour rests on.
 *
 * The source-scanning tests at the top are unusual for a unit suite and are
 * here on purpose: they assert invariants that no single component owns. "No
 * component anywhere renders log content as markup" cannot be checked by
 * testing components one at a time — the next one added is exactly the one that
 * would break it — so it is checked over the tree.
 */

/*
 * The source tree, from the project root.
 *
 * Not derived from import.meta.url: Vitest serves test modules through Vite's
 * transform, so import.meta.url is not a file: URL and fileURLToPath rejects
 * it. process.cwd() is the project root Vitest reports on startup.
 */
const SRC = join(process.cwd(), 'src');

/**
 * The file with its comments removed.
 *
 * The first version of this scan flagged a comment reading "Plain text, never
 * dangerouslySetInnerHTML" — documentation of the invariant, reported as a
 * breach of it. The check is about what the code does, so the prose goes first.
 */
function codeOf(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')     // block comments, including JSX {/* */} bodies
    .replace(/(^|[^:])\/\/.*$/gm, '$1');   // line comments, leaving http:// alone
}

function sourceFiles(dir = SRC, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'test') sourceFiles(full, found);
    } else if (/\.(jsx?|css)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe('Output safety', () => {
  const files = sourceFiles().filter((f) => /\.jsx?$/.test(f));

  it('never renders anything as raw markup', () => {
    /*
     * The audit trail is full of attacker-influenced strings: a crafted user
     * agent, a URL from a refused request, a name someone typed at
     * registration. React escapes text by default, so the dashboard is safe
     * precisely as long as nothing reaches for the escape hatch — which is an
     * invariant over the whole tree, not a property of any one component.
     */
    const offenders = files.filter((file) =>
      /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(codeOf(file)));

    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });

  it('builds no link or redirect target out of fetched data', () => {
    /*
     * A `javascript:` URL in an href executes on click. Nothing in the console
     * renders a URL that came from the service — every destination is a literal
     * route — and this keeps it that way, because the day somebody renders a
     * log field as a link is the day that matters.
     */
    const offenders = [];
    for (const file of files) {
      const source = codeOf(file);
      // An href or src whose value is an interpolated expression that is not a
      // template of literal route segments.
      const matches = source.match(/(?:href|src)=\{(?!`\/)[^}]*\}/g) || [];
      for (const match of matches) {
        // `to={...}` is react-router and goes through its own resolution; these
        // are raw href/src only.
        if (!/^(?:href|src)=\{["'`]/.test(match)) offenders.push(`${relative(SRC, file)}: ${match}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps no token in a store a script can read', () => {
    /*
     * The one rule the token design rests on. localStorage is used for the
     * theme and the device id, which are not credentials; it must never hold a
     * token, and the check is scoped to the files that could.
     */
    const tokenFiles = files.filter((f) => /api|auth/.test(relative(SRC, f)));
    const offenders = [];
    for (const file of tokenFiles) {
      const source = codeOf(file);
      // A storage write whose key or value mentions a token.
      const writes = source.match(/(?:localStorage|sessionStorage)\.setItem\([^)]*\)/g) || [];
      for (const write of writes) {
        if (/token|jwt|bearer|credential/i.test(write)) {
          offenders.push(`${relative(SRC, file)}: ${write}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('The time window', () => {
  it('resolves the named windows to the right span', async () => {
    const { resolve } = await import('../../../auth-service/src/utils/timeWindow');
    const day = resolve({ window: '24h' });
    expect(Math.round(day.spanMs / 3600_000)).toBe(24);
    // The previous period is one span further back, so a trend compares like
    // with like.
    expect(day.from - day.previousFrom).toBe(day.spanMs);
  });

  it('treats a reversed range as the default span rather than producing nothing', async () => {
    const { resolve } = await import('../../../auth-service/src/utils/timeWindow');
    const backwards = resolve({ from: '2026-11-10T00:00:00Z', to: '2026-11-01T00:00:00Z' });
    // Every count would be zero and every trend infinite otherwise.
    expect(backwards.to > backwards.from).toBe(true);
    expect(Math.round(backwards.spanMs / 3600_000)).toBe(24);
  });

  it('reports no percentage for growth from zero', async () => {
    const { trend } = await import('../../../auth-service/src/utils/timeWindow');
    // +100% would read as "doubled" when it is the first occurrence of something.
    expect(trend(5, 0)).toBeNull();
    expect(trend(0, 0)).toBe(0);
    expect(trend(15, 10)).toBe(50);
    expect(trend(5, 10)).toBe(-50);
  });

  it('picks a bucket width that gives a chart a readable number of points', async () => {
    const { bucketFor, HOURS } = await import('../../../auth-service/src/utils/timeWindow');
    const points = (key) => (HOURS[key] * 3600) / bucketFor(key, HOURS[key] * 3600_000).seconds;
    for (const key of ['24h', '7d', '30d']) {
      expect(points(key)).toBeGreaterThanOrEqual(24);
      expect(points(key)).toBeLessThanOrEqual(60);
    }
  });
});

describe('The data palette', () => {
  it('assigns a colour per entity, not per rank', async () => {
    const { assignColours, resetColourAssignments } = await import('../charts/palette');
    resetColourAssignments();
    // A filter that changes the series count must not repaint the survivors.
    const all = assignColours(['login_success', 'login_blocked', 'resource_access']);
    const fewer = assignColours(['login_success', 'resource_access']);
    expect(fewer.get('login_success')).toBe(all.get('login_success'));
  });

  it('folds a ninth series into Other rather than inventing a colour', async () => {
    const { foldSeries } = await import('../charts/palette');
    const many = Array.from({ length: 11 }, (_, i) => ({ key: `e${i}`, label: `E${i}`, total: 11 - i }));
    const { series, folded } = foldSeries(many);

    // The slot order is the colour-vision safety mechanism, so a ninth slot
    // would be a colour nobody measured.
    expect(series).toHaveLength(8);
    expect(series[series.length - 1].key).toBe('__other');
    expect(folded).toHaveLength(4);
    expect(series[series.length - 1].total).toBe(folded.reduce((s, f) => s + f.total, 0));
  });
});

describe('Request handling', () => {
  beforeEach(() => {
    stubFetch([streamStub().route]);
  });

  it('drops empty filters instead of sending them as empty strings', async () => {
    const { setTokens, api } = await import('../api/client');
    setTokens({ accessToken: 'tok' });
    const stub = stubFetch([streamStub().route]);

    await api.get('/admin/events', { window: '24h', severity: '', role: undefined, userId: null });

    const url = String(stub.mock.calls[0][0]);
    // The service validates strictly, so `severity=` is a 400 rather than
    // "no severity filter".
    expect(url).toContain('window=24h');
    expect(url).not.toContain('severity');
    expect(url).not.toContain('role');
    expect(url).not.toContain('userId');
  });

  it('refreshes once and replays the request when the token has expired', async () => {
    const { setTokens, api } = await import('../api/client');
    setTokens({ accessToken: 'stale', refreshToken: 'refresh-0123456789abcdef0123456789abcdef' });

    let eventsCalls = 0;
    const stub = stubFetch([
      streamStub().route,
      [/\/admin\/events/, () => {
        eventsCalls += 1;
        if (eventsCalls === 1) {
          return { status: 401, body: { error: 'Access token expired', code: 'TOKEN_EXPIRED' } };
        }
        return { total: 0, events: [] };
      }],
      [/\/auth\/refresh/, () => ({ accessToken: 'fresh', refreshToken: 'next-token', expiresIn: 900 })],
    ]);

    const result = await api.get('/admin/events');
    expect(result.total).toBe(0);
    expect(eventsCalls).toBe(2);

    // The replay carries the new token, not the stale one.
    const replay = stub.mock.calls.filter(([url]) => String(url).includes('/admin/events')).pop();
    expect(replay[1].headers.Authorization).toBe('Bearer fresh');
  });

  it('refreshes only once for several requests that expire together', async () => {
    const { setTokens, api } = await import('../api/client');
    setTokens({ accessToken: 'stale', refreshToken: 'refresh-0123456789abcdef0123456789abcdef' });

    const expired = new Set();
    let refreshes = 0;
    stubFetch([
      streamStub().route,
      [/\/auth\/refresh/, () => {
        refreshes += 1;
        return { accessToken: 'fresh', refreshToken: 'next', expiresIn: 900 };
      }],
      [/\/admin\/(events|sessions|stats)/, ({ url }) => {
        const key = String(url).split('?')[0];
        if (!expired.has(key)) {
          expired.add(key);
          return { status: 401, body: { error: 'Access token expired', code: 'TOKEN_EXPIRED' } };
        }
        return { ok: true };
      }],
    ]);

    await Promise.all([
      api.get('/admin/events'),
      api.get('/admin/sessions'),
      api.get('/admin/stats/summary'),
    ]);

    /*
     * One refresh, not three. The service rotates the refresh token on every
     * use and treats a second use of the old one as a replay, so three
     * concurrent refreshes would end the session rather than extend it.
     */
    expect(refreshes).toBe(1);
  });

  it('does not retry a session that was deliberately ended', async () => {
    const { setTokens, api, onSessionLost } = await import('../api/client');
    setTokens({ accessToken: 'tok', refreshToken: 'refresh-0123456789abcdef0123456789abcdef' });

    let refreshes = 0;
    const lost = vi.fn();
    onSessionLost(lost);

    stubFetch([
      streamStub().route,
      [/\/auth\/refresh/, () => { refreshes += 1; return { accessToken: 'x' }; }],
      [/\/admin\/events/, () => ({
        status: 401, body: { error: 'Session has ended', code: 'SESSION_ENDED' },
      })],
    ]);

    await expect(api.get('/admin/events')).rejects.toThrow(/Session has ended/);
    // Refreshing past a revocation would be the dashboard arguing with it.
    expect(refreshes).toBe(0);
    expect(lost).toHaveBeenCalled();
  });

  it('separates an unreachable service from a refusal', async () => {
    const { setTokens, api, ApiError } = await import('../api/client');
    setTokens({ accessToken: 'tok' });
    stubFetch([
      streamStub().route,
      [/\/admin\/events/, () => { throw new TypeError('socket hang up'); }],
    ]);

    await api.get('/admin/events').then(
      () => { throw new Error('should have failed'); },
      (err) => {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe('NETWORK');
      }
    );
  });
});

describe('Idle timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    return () => vi.useRealTimers();
  });

  it('signs out after the configured period with no activity', async () => {
    const { useIdleTimeout } = await import('../auth/useIdleTimeout');
    const onTimeout = vi.fn();

    renderHook(() => useIdleTimeout({ enabled: true, timeoutMinutes: 1, onTimeout }));

    expect(onTimeout).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('fires once, not on every tick after the deadline', async () => {
    const { useIdleTimeout } = await import('../auth/useIdleTimeout');
    const onTimeout = vi.fn();

    renderHook(() => useIdleTimeout({ enabled: true, timeoutMinutes: 1, onTimeout }));
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });

    // A slow sign-out must not be started again by the next 5-second tick.
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('is reset by real input', async () => {
    const { useIdleTimeout } = await import('../auth/useIdleTimeout');
    const onTimeout = vi.fn();

    renderHook(() => useIdleTimeout({ enabled: true, timeoutMinutes: 1, onTimeout }));

    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    await act(async () => { window.dispatchEvent(new Event('keydown')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });

    // 100 seconds have passed but the last 50 were after a keystroke.
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('warns before signing out', async () => {
    const { useIdleTimeout } = await import('../auth/useIdleTimeout');
    const { result } = renderHook(() =>
      useIdleTimeout({ enabled: true, timeoutMinutes: 2, onTimeout: () => {} }));

    expect(result.current.msRemaining).toBeNull();
    // Being signed out mid-sentence with no warning teaches people to keep a
    // second tab open to avoid it, which defeats the control.
    await act(async () => { await vi.advanceTimersByTimeAsync(70_000); });
    expect(result.current.msRemaining).toBeLessThanOrEqual(60_000);
    expect(result.current.msRemaining).toBeGreaterThan(0);
  });

  it('does nothing when it is not enabled', async () => {
    const { useIdleTimeout } = await import('../auth/useIdleTimeout');
    const onTimeout = vi.fn();

    renderHook(() => useIdleTimeout({ enabled: false, timeoutMinutes: 1, onTimeout }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

describe('Polling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    return () => vi.useRealTimers();
  });

  it('pauses while the tab is hidden', async () => {
    const { useInterval } = await import('../dashboard/useResource');
    const tick = vi.fn();

    renderHook(() => useInterval(tick, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    const whileVisible = tick.mock.calls.length;
    expect(whileVisible).toBeGreaterThan(0);

    /*
     * The service flags a session that makes too many requests, so a console
     * left open on a background tab overnight must not quietly trip the
     * detector it exists to display.
     */
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(tick.mock.calls.length).toBe(whileVisible);
  });
});
