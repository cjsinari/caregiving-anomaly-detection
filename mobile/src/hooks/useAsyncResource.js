import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * One load, four states, and nobody writing them out by hand again.
 *
 * Issue #44 asks for empty, loading and error states on every list. There are
 * five lists across these screens, and five hand-rolled copies of
 * `useState(null) / useState(true) / useState(null)` is five chances to forget
 * the error branch, five subtly different ideas of what "empty" means, and
 * five places a response can land after the screen has gone.
 *
 * So: this. `status` is the single source of truth and a screen renders a
 * branch on it rather than reasoning about which of three booleans wins.
 *
 *   loading   first load, nothing to show yet
 *   refreshing  a reload with stale data still on screen -- the pull-to-refresh
 *               case, where blanking the list would be a worse answer than
 *               leaving yesterday's visible for another second
 *   ready     `data` is good
 *   error     `error` says why, and `reload` is how to try again
 *
 * ── Why a reload keeps the old data ──
 *
 * Because a caregiver pulling to refresh their visit list has not asked for it
 * to disappear. The list stays, the spinner says something is happening, and
 * the new list replaces it when it lands. The same reason a *failed* reload
 * keeps the old data rather than clearing it: stale visits are more useful
 * than no visits, so the error is shown as a banner above the list rather than
 * instead of it.
 */
export default function useAsyncResource(loader, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null,
  });

  /*
   * Only the newest load may write.
   *
   * Two loads can be in flight at once -- a reload fired while the first is
   * still going, a dependency changing mid-request -- and without this the
   * slower one wins by arriving last. On a mobile connection that is not a
   * rare race; it is Tuesday.
   */
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Held in a ref so `run` does not have to be rebuilt every render just
  // because the caller passed a fresh arrow function.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const run = useCallback(async ({ quiet = false } = {}) => {
    const mine = ++generation.current;

    setState((prev) => ({
      ...prev,
      // A reload with something already on screen keeps it there.
      status: quiet || prev.data != null ? 'refreshing' : 'loading',
    }));

    try {
      const data = await loaderRef.current();
      if (!alive.current || mine !== generation.current) return;
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      if (!alive.current || mine !== generation.current) return;
      setState((prev) => ({
        status: 'error',
        // Keep whatever was already there. See the note above.
        data: prev.data,
        error: err,
      }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', data: null, error: null });
      return undefined;
    }
    run();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  /** Replace the data without a round trip. What an optimistic write uses. */
  const setData = useCallback((updater) => {
    setState((prev) => ({
      ...prev,
      data: typeof updater === 'function' ? updater(prev.data) : updater,
    }));
  }, []);

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    isLoading: state.status === 'loading',
    isRefreshing: state.status === 'refreshing',
    isError: state.status === 'error',
    reload: run,
    setData,
  };
}
