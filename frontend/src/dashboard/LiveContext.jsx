import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getAccessToken, onSessionLost } from '../api/client';

/*
 * Live security events.
 *
 * ── Why fetch and not EventSource ──
 *
 * The browser's EventSource cannot send request headers. It has no API for it,
 * by design. That leaves three ways to authenticate a live stream, and only one
 * of them is acceptable:
 *
 *   - the token in the query string: it would then be in the service's access
 *     log, in any proxy's log, and in the browser's history — a bearer token for
 *     the endpoints that freeze accounts, written to half a dozen files that
 *     nobody is treating as secret;
 *   - a cookie: the console deliberately keeps no token where a script can
 *     reach it, and adding one for the stream would reintroduce exactly that;
 *   - fetch with an Authorization header, reading the response body as a stream
 *     and parsing the handful of lines the SSE format consists of.
 *
 * So this parses SSE by hand. It is about forty lines, and it keeps the token
 * in a header where it belongs.
 *
 * ── Falling back ──
 *
 * The stream's first message says whether delivery is actually live — the
 * service reports `live: false` when its Redis fan-out is unavailable rather
 * than holding a connection open that will never produce anything. Either that
 * answer or a failure to connect at all puts this into polling mode, and
 * `mode` is exposed so the interface can say which one is in force. A dashboard
 * that silently stopped receiving events would be worse than one that polls,
 * because "nothing is happening" and "I am no longer being told" look identical
 * on screen.
 */

const LiveContext = createContext(null);

const BASE = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

/** How many recent events to hold for the notification list. */
const KEEP = 50;

/** Reconnect backoff, in milliseconds. Capped so it keeps trying. */
const BACKOFF = [1000, 2000, 5000, 10_000, 30_000];

export function LiveProvider({ children }) {
  const [mode, setMode] = useState('connecting');   // connecting | live | polling
  const [events, setEvents] = useState([]);
  const [unread, setUnread] = useState(0);
  const [lastEventAt, setLastEventAt] = useState(null);

  // A monotonically increasing token: anything that changes the feed bumps it,
  // so panels can depend on it to know their data is stale without each one
  // subscribing to the event list and re-rendering per event.
  const [revision, setRevision] = useState(0);

  const attempt = useRef(0);
  const stopped = useRef(false);

  const push = useCallback((event) => {
    setEvents((current) => [{ ...event, id: `${event.at}-${current.length}` }, ...current].slice(0, KEEP));
    setLastEventAt(event.at || new Date().toISOString());
    setRevision((n) => n + 1);
    // Only events worth interrupting someone for count towards the badge.
    // Counting routine sign-ins would give an administrator a number that is
    // always large and therefore never informative.
    if (event.severity === 'high' || event.severity === 'critical') {
      setUnread((n) => n + 1);
    }
  }, []);

  const markRead = useCallback(() => setUnread(0), []);
  const clearEvents = useCallback(() => { setEvents([]); setUnread(0); }, []);

  useEffect(() => {
    stopped.current = false;
    let controller = null;
    let retry = null;

    const scheduleRetry = () => {
      if (stopped.current) return;
      const wait = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)];
      attempt.current += 1;
      retry = setTimeout(connect, wait);
    };

    async function connect() {
      if (stopped.current) return;

      const token = getAccessToken();
      // No token yet — the provider mounts inside the layout, so this only
      // happens in the moment between sign-in and the first render.
      if (!token) { scheduleRetry(); return; }

      controller = new AbortController();
      try {
        const response = await fetch(`${BASE}/admin/stream`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          // 401 and 403 are not worth retrying against: the session is gone or
          // the account is not allowed. The client's own session handling deals
          // with the former; here it just means stop and poll.
          if (response.status === 401 || response.status === 403) {
            setMode('polling');
            return;
          }
          throw new Error(`stream responded ${response.status}`);
        }

        attempt.current = 0;
        await readStream(response.body, { onEvent: push, onReady: (ready) => {
          setMode(ready.live ? 'live' : 'polling');
        } });

        // The stream ended cleanly, which for SSE means the connection dropped.
        if (!stopped.current) { setMode('connecting'); scheduleRetry(); }
      } catch (err) {
        if (err.name === 'AbortError' || stopped.current) return;
        setMode('polling');
        scheduleRetry();
      }
    }

    connect();

    // A lost session invalidates the stream's token; stop rather than retrying
    // with a credential that is now refused.
    const offSessionLost = onSessionLost(() => {
      stopped.current = true;
      controller?.abort();
      setMode('polling');
    });

    return () => {
      stopped.current = true;
      clearTimeout(retry);
      controller?.abort();
      offSessionLost();
    };
  }, [push]);

  const value = useMemo(() => ({
    mode,
    isLive: mode === 'live',
    events,
    unread,
    lastEventAt,
    revision,
    markRead,
    clearEvents,
  }), [mode, events, unread, lastEventAt, revision, markRead, clearEvents]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/**
 * Read an SSE body.
 *
 * The format is small: lines, blank-line-separated records, `field: value`, and
 * a leading colon for a comment (which is what the service's heartbeat is). The
 * only subtlety is that a chunk boundary can fall anywhere, including inside a
 * line, so the tail of each chunk is carried over rather than parsed.
 */
async function readStream(body, { onEvent, onReady }) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;

    buffer += decoder.decode(value, { stream: true });

    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const record = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let name = 'message';
      const dataLines = [];
      for (const line of record.split('\n')) {
        if (!line || line.startsWith(':')) continue;       // heartbeat or padding
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;

      let payload;
      try { payload = JSON.parse(dataLines.join('\n')); } catch { continue; }

      if (name === 'ready') onReady(payload);
      else if (name === 'security') onEvent(payload);
    }
  }
}

export function useLive() {
  const context = useContext(LiveContext);
  if (!context) throw new Error('useLive must be used inside a LiveProvider');
  return context;
}
