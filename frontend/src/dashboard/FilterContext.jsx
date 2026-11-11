import { createContext, useCallback, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/*
 * The time range and filters every view shares.
 *
 * ── Why the URL and not a context value ──
 *
 * The state lives in the query string, with the context only reading and
 * writing it. That is what makes an investigation transferable: an
 * administrator who finds something at 2am can paste the address into a ticket
 * and the person who picks it up sees the same thirty hours, the same severity
 * filter and the same account — rather than a default view and a paragraph
 * explaining how to reproduce it. It also makes the back button work the way it
 * looks like it should, and survives the reload that an in-memory token store
 * makes necessary from time to time.
 *
 * The acceptance criterion for this module is that the views agree with each
 * other about what "the last 7 days" means. One source they all read, rather
 * than one default they each copy, is how that is guaranteed instead of
 * maintained.
 *
 * Empty values are deleted from the query string rather than written as empty
 * strings, so the address stays readable and the service — which rejects
 * unknown and malformed parameters rather than ignoring them — never receives
 * a filter that means "no filter".
 */

const FilterContext = createContext(null);

export const WINDOWS = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
];

export const SEVERITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'info', label: 'Info' },
];

export const ROLES = [
  { value: 'family', label: 'Family member' },
  { value: 'caregiver', label: 'Caregiver' },
  { value: 'administrator', label: 'Administrator' },
];

/*
 * The filters that travel between views, and their defaults.
 *
 * `window` is shared by everything. The others are shared where they mean the
 * same thing — a severity filter means the same on the overview as on the event
 * table — so following a drill-down keeps the context the administrator was
 * already in. Anything view-specific (a page offset, a sort column) is
 * deliberately not here: carrying page 4 of the event table into the anomaly
 * list would be nonsense.
 */
const SHARED = {
  window: '24h',
  // An explicit range, which the service prefers over the named window. Written
  // by a drill-down from a chart, where "this bucket" is a precise interval
  // rather than one of the preset periods.
  from: '',
  to: '',
  severity: '',
  eventType: '',
  role: '',
  layer: '',
  search: '',
  userId: '',
  // Who acted. Shared because it means the same thing on the audit log and on
  // the event feed, so following a link between them keeps the narrowing.
  actorType: '',
  decision: '',
};

export function FilterProvider({ children }) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => {
    const value = {};
    for (const [key, fallback] of Object.entries(SHARED)) {
      value[key] = params.get(key) ?? fallback;
    }
    return value;
  }, [params]);

  /**
   * Change one or more filters.
   *
   * `replace` is used for changes that are not navigation — adjusting a filter
   * while reading one screen should not add an entry to the history for every
   * keystroke in a search box. A drill-down passes replace: false, because
   * going "back" from it is exactly what an administrator will want.
   */
  const setFilters = useCallback((changes, { replace = true } = {}) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === null || value === '' || value === SHARED[key]) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }
      // A filter change invalidates the page the administrator was on: page 4
      // of the old result set is not page 4 of the new one, and silently
      // keeping the offset is how a filter change produces an empty table.
      next.delete('offset');
      return next;
    }, { replace });
  }, [setParams]);

  const clearFilters = useCallback(() => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      // The window is not a filter — it is the frame everything is read in — so
      // "clear filters" narrows nothing and leaves it alone.
      for (const key of Object.keys(SHARED)) if (key !== 'window') next.delete(key);
      next.delete('offset');
      return next;
    }, { replace: true });
  }, [setParams]);

  /*
   * The shared filters as a query string, for a link to another view.
   *
   * The state lives in the URL, which makes an investigation transferable — but
   * it also means a plain <NavLink to="/events"> navigates to a bare path and
   * silently drops every filter. The views were then only "sharing" state while
   * an administrator stayed on one screen, which is the opposite of the point;
   * an end-to-end test caught it by setting a 7-day window and finding a
   * 24-hour one on the next page.
   *
   * Only the shared keys travel. A view's own state deliberately does not:
   * carrying `offset=150` to a different result set is meaningless, and
   * `status=flagged` means a session state on one screen and an account
   * standing on another, where it is not even a valid value.
   */
  const sharedSearch = useMemo(() => {
    const next = new URLSearchParams();
    for (const key of Object.keys(SHARED)) {
      const value = params.get(key);
      if (value !== null && value !== '' && value !== SHARED[key]) next.set(key, value);
    }
    const query = next.toString();
    return query ? `?${query}` : '';
  }, [params]);

  /** Which narrowing filters are in force, for the "N filters" summary. */
  const activeFilters = useMemo(
    () => Object.entries(filters).filter(([key, value]) => key !== 'window' && value !== ''),
    [filters]
  );

  /**
   * The filters to send to the service, with the empty ones left out.
   *
   * The API client also drops empty values, but building the object here means
   * a view never has to remember to — and a stray `severity: ''` is a 400 from
   * a service that validates strictly, which is the right behaviour on its side
   * and a bug on ours.
   */
  const queryFor = useCallback((extra = {}) => {
    const query = {};
    for (const [key, value] of Object.entries({ ...filters, ...extra })) {
      if (value !== undefined && value !== null && value !== '') query[key] = value;
    }
    return query;
  }, [filters]);

  const value = useMemo(() => ({
    filters,
    setFilters,
    clearFilters,
    activeFilters,
    queryFor,
    sharedSearch,
    window: filters.window,
    setWindow: (next) => setFilters({ window: next }),
  }), [filters, setFilters, clearFilters, activeFilters, queryFor, sharedSearch]);

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (!context) throw new Error('useFilters must be used inside a FilterProvider');
  return context;
}
