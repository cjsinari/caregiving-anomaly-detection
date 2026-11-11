import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * One request, with its loading and error states.
 *
 * Every panel needs the same four things — is it loading, did it fail, what came
 * back, and reload it — and writing that out per panel is how one of them ends
 * up rendering a stale result after the filters changed, or setting state after
 * the component has gone.
 *
 * Two behaviours worth naming:
 *
 *  - A request in flight is aborted when the dependencies change. Without that,
 *    typing in a search box fires a request per keystroke and whichever one the
 *    network happens to return last wins, which is not necessarily the one
 *    matching what is now in the box.
 *  - Previous data is kept while reloading, with `refreshing` true. A dashboard
 *    that blanks its charts every time the window ticks over is harder to read
 *    than one whose numbers update in place.
 */
export function useResource(fetcher, deps = [], { enabled = true, keepPrevious = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  // The fetcher is almost always an inline arrow, so a new function every
  // render. Keeping it in a ref means the effect depends on `deps` — what the
  // caller declared — rather than re-running on every render.
  const latest = useRef(fetcher);
  latest.current = fetcher;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    setState((previous) => ({
      data: keepPrevious ? previous.data : null,
      error: null,
      loading: !(keepPrevious && previous.data),
    }));
    setRefreshing(true);

    latest.current({ signal: controller.signal })
      .then((data) => { if (active) setState({ data, error: null, loading: false }); })
      .catch((error) => {
        // An aborted request is this effect's own cleanup, not a failure to
        // report: showing the administrator an error because they typed another
        // character would be the hook complaining about itself.
        if (!active || error.name === 'AbortError') return;
        setState((previous) => ({ data: keepPrevious ? previous.data : null, error, loading: false }));
      })
      .finally(() => { if (active) setRefreshing(false); });

    return () => { active = false; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, keepPrevious, nonce]);

  return { ...state, refreshing, reload };
}

/**
 * Re-run something on an interval, pausing while the tab is hidden.
 *
 * The pause is not an optimisation. The service applies a per-session request
 * budget and flags a session that crosses the hard limit as an anomaly — so a
 * console left open on a background tab overnight, polling every thirty
 * seconds, would eventually trip the very detector it exists to display.
 */
export function useInterval(callback, ms, { enabled = true } = {}) {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (!enabled || !ms) return undefined;

    let timer = null;
    const tick = () => { if (!document.hidden) latest.current(); };

    const start = () => { if (!timer) timer = setInterval(tick, ms); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        // Catch up once on return, then resume: coming back to a console
        // showing numbers from an hour ago is worse than one extra request.
        latest.current();
        start();
      }
    };

    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [ms, enabled]);
}
