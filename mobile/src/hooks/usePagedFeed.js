import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * A feed that pages in from the bottom and refreshes from the top.
 *
 * Item 2 of issue #45: the care updates feed, with pull-to-refresh and
 * infinite scroll. Both are one line each in a FlatList and both are wrong in
 * the same handful of ways if left at one line, so this hook exists to get
 * them right once.
 *
 * ── What goes wrong, and what this does about each ──
 *
 * onEndReached fires more than once. FlatList calls it on the way into the
 * threshold, again on a layout change, again on a momentum bounce. Without a
 * guard that is two requests for page two, and two copies of page two on
 * screen. Guarded by a ref, not by state, because the second call arrives
 * before a state update from the first has rendered.
 *
 * A refresh races a page load. Pull to refresh while page three is in flight,
 * and page three lands *after* the fresh page one -- appended to a list it no
 * longer belongs to, carrying a cursor from the old list. Every load is
 * stamped with a generation, a refresh starts a new one, and anything from an
 * older generation is dropped on arrival.
 *
 * Duplicates across pages. A report filed between two page loads can push an
 * item from the end of one page to the start of the next. The cursor contract
 * (see mock/familyData.js) already avoids most of this; dedupe by id is the
 * belt to those braces, because a feed showing the same visit twice reads as
 * the visit having happened twice.
 *
 * Failure in the middle. Page three failing must not throw away pages one and
 * two -- the person is reading them. `pageError` is separate from `error` for
 * exactly this: an error with nothing loaded takes the screen, an error loading
 * *more* is a retry row at the bottom of a list that stays where it is.
 *
 * A refresh that fails keeps the list, for the reason useAsyncResource gives:
 * stale updates beat no updates.
 */
export default function usePagedFeed(loadPage, deps = [], { enabled = true } = {}) {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState(enabled ? 'loading' : 'idle');
  const [error, setError] = useState(null);
  const [pageError, setPageError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const cursor = useRef(null);
  const generation = useRef(0);
  const pageInFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const loaderRef = useRef(loadPage);
  loaderRef.current = loadPage;

  /** Load page one and replace whatever is there. Used by mount and by refresh. */
  const loadFirst = useCallback(async ({ asRefresh = false } = {}) => {
    const mine = ++generation.current;
    // A refresh supersedes any page in flight; its reply will be dropped.
    pageInFlight.current = false;
    setLoadingMore(false);
    setPageError(null);
    if (asRefresh) setRefreshing(true);
    else setStatus('loading');

    try {
      const page = await loaderRef.current({ cursor: null });
      if (!alive.current || mine !== generation.current) return;
      cursor.current = page.nextCursor ?? null;
      setItems(dedupe([], page.items ?? []));
      setHasMore(Boolean(page.nextCursor));
      setError(null);
      setStatus('ready');
    } catch (err) {
      if (!alive.current || mine !== generation.current) return;
      setError(err);
      setStatus('error');
    } finally {
      if (alive.current && mine === generation.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      setItems([]);
      return;
    }
    cursor.current = null;
    setItems([]);
    loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const refresh = useCallback(() => loadFirst({ asRefresh: true }), [loadFirst]);

  const loadMore = useCallback(async () => {
    // The guard onEndReached needs; see the note at the top.
    if (pageInFlight.current || !cursor.current) return;
    pageInFlight.current = true;
    const mine = generation.current;
    setLoadingMore(true);
    setPageError(null);

    try {
      const page = await loaderRef.current({ cursor: cursor.current });
      if (!alive.current || mine !== generation.current) return;
      cursor.current = page.nextCursor ?? null;
      setItems((current) => dedupe(current, page.items ?? []));
      setHasMore(Boolean(page.nextCursor));
    } catch (err) {
      if (!alive.current || mine !== generation.current) return;
      setPageError(err);
    } finally {
      if (alive.current && mine === generation.current) {
        pageInFlight.current = false;
        setLoadingMore(false);
      }
    }
  }, []);

  return {
    items,
    status,
    error,
    pageError,
    refreshing,
    loadingMore,
    hasMore,
    refresh,
    loadMore,
    isEmpty: status === 'ready' && items.length === 0,
  };
}

/** Append `incoming` to `current`, skipping anything already present. */
function dedupe(current, incoming) {
  const seen = new Set(current.map((item) => item.id));
  const next = current.slice();
  incoming.forEach((item) => {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      next.push(item);
    }
  });
  return next;
}
