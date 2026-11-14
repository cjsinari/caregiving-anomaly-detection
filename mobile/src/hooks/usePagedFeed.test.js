import { act, renderHook } from '@testing-library/react-native';
import usePagedFeed from './usePagedFeed';

/*
 * Pull-to-refresh and infinite scroll, item 2 of issue #45.
 *
 * Each test here is one of the ways a feed goes wrong in the field and looks
 * fine on a fast laptop: a doubled page from onEndReached firing twice, a
 * stale page landing on top of a fresh refresh, a failure on page three
 * wiping pages one and two.
 */

const item = (n) => ({ id: `u${n}`, title: `Update ${n}` });
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => item(from + i));

/** A loader whose pages resolve when the test says so. */
function controlled() {
  const calls = [];
  const fn = jest.fn(({ cursor }) => new Promise((resolve, reject) => {
    calls.push({ cursor, resolve, reject });
  }));
  return {
    fn,
    calls,
    answer: (i, page) => act(async () => { calls[i].resolve(page); }),
    fail: (i, message = 'Network unavailable') => act(async () => { calls[i].reject(new Error(message)); }),
  };
}

describe('the first page', () => {
  it('loads on mount and reports that there is more', async () => {
    const api = controlled();
    const { result } = await renderHook(() => usePagedFeed(api.fn));

    expect(result.current.status).toBe('loading');
    await api.answer(0, { items: range(1, 10), nextCursor: 'u10' });

    expect(result.current.status).toBe('ready');
    expect(result.current.items).toHaveLength(10);
    expect(result.current.hasMore).toBe(true);
  });

  it('calls an empty feed empty, not loading', async () => {
    const api = controlled();
    const { result } = await renderHook(() => usePagedFeed(api.fn));
    await api.answer(0, { items: [], nextCursor: null });

    expect(result.current.isEmpty).toBe(true);
    expect(result.current.hasMore).toBe(false);
  });

  it('takes the screen with an error only when nothing is loaded', async () => {
    const api = controlled();
    const { result } = await renderHook(() => usePagedFeed(api.fn));
    await api.fail(0, 'Offline');

    expect(result.current.status).toBe('error');
    expect(result.current.error.message).toBe('Offline');
  });
});

describe('infinite scroll', () => {
  const twoPages = async () => {
    const api = controlled();
    const hook = await renderHook(() => usePagedFeed(api.fn));
    await api.answer(0, { items: range(1, 10), nextCursor: 'u10' });
    return { api, ...hook };
  };

  it('asks for the next page with the cursor it was given', async () => {
    const { api, result } = await twoPages();

    await act(async () => { result.current.loadMore(); });
    expect(api.fn).toHaveBeenLastCalledWith({ cursor: 'u10' });
    await api.answer(1, { items: range(11, 20), nextCursor: 'u20' });

    expect(result.current.items).toHaveLength(20);
    expect(result.current.items[10].id).toBe('u11');
  });

  it('sends one request when onEndReached fires twice', async () => {
    const { api, result } = await twoPages();

    // FlatList does this on the way into the threshold and again on a bounce.
    await act(async () => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });

    expect(api.fn).toHaveBeenCalledTimes(2);   // page one, and page two once
  });

  it('never shows the same update twice', async () => {
    const { api, result } = await twoPages();

    await act(async () => { result.current.loadMore(); });
    // A report filed between the two loads pushed u10 onto page two as well.
    await api.answer(1, { items: range(10, 19), nextCursor: 'u19' });

    const ids = result.current.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(19);
  });

  it('stops at the end, and says so', async () => {
    const { api, result } = await twoPages();

    await act(async () => { result.current.loadMore(); });
    await api.answer(1, { items: range(11, 14), nextCursor: null });

    expect(result.current.hasMore).toBe(false);
    await act(async () => { result.current.loadMore(); });
    expect(api.fn).toHaveBeenCalledTimes(2);
  });

  it('keeps what is loaded when a later page fails, and can retry it', async () => {
    const { api, result } = await twoPages();

    await act(async () => { result.current.loadMore(); });
    await api.fail(1, 'Lost signal');

    // Pages already on screen stay: the person is reading them.
    expect(result.current.items).toHaveLength(10);
    expect(result.current.status).toBe('ready');
    expect(result.current.pageError.message).toBe('Lost signal');

    await act(async () => { result.current.loadMore(); });
    expect(api.fn).toHaveBeenLastCalledWith({ cursor: 'u10' });
    await api.answer(2, { items: range(11, 20), nextCursor: null });

    expect(result.current.items).toHaveLength(20);
    expect(result.current.pageError).toBeNull();
  });
});

describe('pull to refresh', () => {
  it('replaces the list with a fresh first page', async () => {
    const api = controlled();
    const { result } = await renderHook(() => usePagedFeed(api.fn));
    await api.answer(0, { items: range(1, 10), nextCursor: 'u10' });

    await act(async () => { result.current.refresh(); });
    expect(result.current.refreshing).toBe(true);
    // The old list stays on screen while the refresh runs.
    expect(result.current.items).toHaveLength(10);

    await api.answer(1, { items: [item(0), ...range(1, 9)], nextCursor: 'u9' });

    expect(result.current.refreshing).toBe(false);
    expect(result.current.items[0].id).toBe('u0');
  });

  it('drops a page that was in flight when the refresh began', async () => {
    const api = controlled();
    const { result } = await renderHook(() => usePagedFeed(api.fn));
    await api.answer(0, { items: range(1, 10), nextCursor: 'u10' });

    await act(async () => { result.current.loadMore(); });    // call 1: page two, slow
    await act(async () => { result.current.refresh(); });     // call 2: fresh page one

    await api.answer(2, { items: range(1, 10), nextCursor: 'u10' });
    // The stale page two straggles in after the refresh.
    await api.answer(1, { items: range(11, 20), nextCursor: 'u20' });

    // Appending it would bolt the old list's page two onto the new list, with
    // a cursor from a list that no longer exists.
    expect(result.current.items).toHaveLength(10);
  });

  it('keeps the list when the refresh fails', async () => {
    const api = controlled();
    const { result } = await renderHook(() => usePagedFeed(api.fn));
    await api.answer(0, { items: range(1, 10), nextCursor: 'u10' });

    await act(async () => { result.current.refresh(); });
    await api.fail(1, 'Offline');

    expect(result.current.items).toHaveLength(10);
    expect(result.current.error.message).toBe('Offline');
    expect(result.current.refreshing).toBe(false);
  });
});

describe('changing what is shown', () => {
  it('starts over when a dependency changes, such as the filter', async () => {
    const api = controlled();
    const { result, rerender } = await renderHook(
      ({ kind }) => usePagedFeed(api.fn, [kind]),
      { initialProps: { kind: null } }
    );
    await api.answer(0, { items: range(1, 10), nextCursor: 'u10' });

    await act(async () => { rerender({ kind: 'incident' }); });
    expect(result.current.items).toHaveLength(0);
    await api.answer(1, { items: [item(99)], nextCursor: null });

    expect(result.current.items.map((i) => i.id)).toEqual(['u99']);
  });
});
