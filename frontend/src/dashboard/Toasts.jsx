import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLive } from './LiveContext';

/*
 * Notifications for events that arrive while the console is open.
 *
 * ── Only what is worth interrupting for ──
 *
 * High and critical only. The service emits an event for every sign-in, token
 * refresh and care-record read; a console that toasted all of them would be
 * unusable within a minute, and — worse — would train whoever is watching to
 * dismiss the notifications without reading them. The feed is still complete:
 * everything is in the event list, and the panels mark themselves stale. The
 * toast is reserved for the thing that should pull someone's eye away from what
 * they were doing.
 *
 * ── Announced, not just drawn ──
 *
 * The container is an aria-live region, so a critical anomaly reaches someone
 * using a screen reader rather than appearing silently in a corner. `assertive`
 * for critical, `polite` for high: an assertive region interrupts whatever is
 * being read, which is right for a block and rude for everything else.
 *
 * Critical toasts do not auto-dismiss. A notification that disappears after
 * four seconds is one that can be missed entirely by someone who looked away,
 * and the whole point of this one is that it should not be.
 */

const DISMISS_AFTER_MS = 8000;
const MAX_VISIBLE = 4;

export default function Toasts() {
  const { events } = useLive();
  const [dismissed, setDismissed] = useState(() => new Set());
  const seen = useRef(new Set());

  // Only events that arrived after mount: on first render the list may already
  // hold recent events, and replaying them as notifications would announce
  // history as though it were happening now.
  const [since] = useState(() => Date.now());

  const notable = events.filter((event) => {
    if (event.severity !== 'high' && event.severity !== 'critical') return false;
    if (dismissed.has(event.id)) return false;
    return new Date(event.at).getTime() >= since - 1000;
  }).slice(0, MAX_VISIBLE);

  useEffect(() => {
    const timers = [];
    for (const event of notable) {
      if (event.severity === 'critical') continue;      // stays until dismissed
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      timers.push(setTimeout(() => {
        setDismissed((current) => new Set(current).add(event.id));
      }, DISMISS_AFTER_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [notable]);

  if (!notable.length) return null;

  const hasCritical = notable.some((e) => e.severity === 'critical');

  return (
    <div
      className="toasts"
      role={hasCritical ? 'alert' : 'status'}
      aria-live={hasCritical ? 'assertive' : 'polite'}
    >
      {notable.map((event) => (
        <article key={event.id} className={`toast toast--${event.severity}`}>
          <div className="toast__body">
            <p className="toast__title">
              {event.severity === 'critical' ? 'Critical' : 'High'} ·{' '}
              {String(event.eventType).replace(/_/g, ' ')}
            </p>
            {/* The service's own sentence, written when the event was recorded. */}
            <p className="toast__detail">{event.explanation}</p>
            <p className="toast__meta small muted">
              {new Date(event.at).toLocaleTimeString()}
              {event.layer ? ` · ${String(event.layer).replace(/_/g, ' ')}` : ''}
            </p>
          </div>
          <div className="toast__actions">
            <Link
              className="btn btn--sm btn--outline"
              to={event.userId ? `/events?userId=${event.userId}` : '/events?severity=critical'}
              onClick={() => setDismissed((c) => new Set(c).add(event.id))}
            >
              Investigate
            </Link>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setDismissed((c) => new Set(c).add(event.id))}
            >
              Dismiss<span className="sr-only"> this notification</span>
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
