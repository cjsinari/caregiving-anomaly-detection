/*
 * The dashboard's time window.
 *
 * Every view on the dashboard is "the last 24 hours / 7 days / 30 days", and the
 * KPI cards additionally need the window immediately before the current one so a
 * count can be shown as a trend rather than a bare number. Resolving that in one
 * place is what lets the event feed, the anomaly list and the summary cards agree
 * on what "the last 7 days" means — the acceptance criterion for the
 * visualisation module is that the views match each other, and they cannot if
 * each one computes its own boundaries.
 *
 * Boundaries are returned as Date objects, never as formatted strings. The
 * timestamp columns are `timestamp without time zone` holding the database's
 * local time; a Date is serialised by the driver with its offset and compared
 * against ::timestamptz, so the comparison is an instant against an instant. A
 * formatted string is where the three-hour offset errors come from.
 */

const HOURS = { '1h': 1, '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 };
const DEFAULT = '24h';
const KEYS = Object.keys(HOURS);

/** The longest window a client may ask for, in hours. Guards the summary scans. */
const MAX_SPAN_HOURS = Number(process.env.ADMIN_MAX_WINDOW_HOURS) || 24 * 366;

/**
 * Resolve a requested window into { window, from, to, previousFrom, spanMs }.
 *
 * An explicit from/to pair wins over a named window, and its `previousFrom` is
 * one span further back, so a custom range gets the same trend arithmetic as a
 * named one. `to` defaults to now and `from` to one default window before `to`,
 * which makes `?from=...` alone mean "since then" and `?to=...` alone mean "the
 * day ending then".
 */
function resolve({ window, from, to } = {}) {
  if (from || to) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - HOURS[DEFAULT] * 3600_000);

    // A reversed or zero-length range would make every count zero and every
    // trend infinite; treat it as the default span ending at `end` instead.
    const spanMs = end > start ? end - start : HOURS[DEFAULT] * 3600_000;
    const clamped = Math.min(spanMs, MAX_SPAN_HOURS * 3600_000);
    const realStart = new Date(end.getTime() - clamped);

    return {
      window: 'custom',
      from: realStart,
      to: end,
      previousFrom: new Date(realStart.getTime() - clamped),
      spanMs: clamped,
    };
  }

  const key = HOURS[window] ? window : DEFAULT;
  const spanMs = HOURS[key] * 3600_000;
  const end = new Date();
  const start = new Date(end.getTime() - spanMs);

  return {
    window: key,
    from: start,
    to: end,
    previousFrom: new Date(start.getTime() - spanMs),
    spanMs,
  };
}

/**
 * The bucket width to group a time series by, given the window.
 *
 * Chosen so a chart gets somewhere between 24 and 60 points: hourly over a day
 * is 24 bars, six-hourly over a week is 28, daily over a month is 30. Returned
 * as a string for date_trunc plus a matching interval, because PostgreSQL's
 * date_trunc has no six-hour unit and that case needs the floor computed
 * arithmetically instead.
 */
function bucketFor(window, spanMs) {
  const hours = spanMs / 3600_000;
  if (hours <= 2) return { unit: 'minute', seconds: 60, label: 'minute' };
  if (hours <= 48) return { unit: 'hour', seconds: 3600, label: 'hour' };
  if (hours <= 24 * 10) return { unit: 'hour', seconds: 6 * 3600, label: '6 hours' };
  return { unit: 'day', seconds: 24 * 3600, label: 'day' };
}

/** The percentage change from `before` to `now`, or null when there is no basis. */
function trend(now, before) {
  const a = Number(now);
  const b = Number(before);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Growth from zero has no percentage. Reporting it as +100% would read as
  // "doubled" when it is in fact the first occurrence of something.
  if (b === 0) return a === 0 ? 0 : null;
  return Math.round(((a - b) / b) * 1000) / 10;
}

module.exports = { resolve, bucketFor, trend, HOURS, KEYS, DEFAULT, MAX_SPAN_HOURS };
