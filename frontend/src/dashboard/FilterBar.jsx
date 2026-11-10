import { useEffect, useState } from 'react';
import { ROLES, SEVERITIES, WINDOWS, useFilters } from './FilterContext';
import { useLive } from './LiveContext';

/*
 * The filter row, above the panels it narrows.
 *
 * One row, one place. Every view reads the same state, so moving from the
 * overview to the event table to the anomaly list keeps the period and the
 * narrowing an administrator had already chosen — which is the difference
 * between following a thread and re-finding it three times.
 *
 * The search box is debounced rather than firing per keystroke. The service
 * counts requests per session and flags a session that asks too often, so a
 * search field that issued a request per character would have the console
 * tripping the detector it exists to display.
 */
export default function FilterBar({ show = ['window', 'severity', 'role', 'search'] }) {
  const { filters, setFilters, clearFilters, activeFilters } = useFilters();
  const visible = new Set(show);

  return (
    <div className="filters">
      {visible.has('window') && (
        <WindowSelector value={filters.window} onChange={(window) => setFilters({ window })} />
      )}

      <div className="filters__fields">
        {visible.has('severity') && (
          <Select
            label="Severity"
            value={filters.severity}
            onChange={(severity) => setFilters({ severity })}
            options={SEVERITIES}
            anyLabel="Any severity"
          />
        )}

        {visible.has('role') && (
          <Select
            label="Account type"
            value={filters.role}
            onChange={(role) => setFilters({ role })}
            options={ROLES}
            anyLabel="Any account type"
          />
        )}

        {visible.has('search') && (
          <SearchBox
            value={filters.search}
            onChange={(search) => setFilters({ search })}
          />
        )}

        {activeFilters.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={clearFilters}>
            Clear {activeFilters.length} filter{activeFilters.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <LiveIndicator />
    </div>
  );
}

/** The period every view is read in. A segmented control, not a dropdown. */
export function WindowSelector({ value, onChange }) {
  return (
    <div className="segmented" role="group" aria-label="Time period">
      {WINDOWS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`segmented__option${value === option.value ? ' segmented__option--on' : ''}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Select({ label, value, onChange, options, anyLabel }) {
  return (
    <label className="filters__field">
      <span className="sr-only">{label}</span>
      <select className="select select--compact" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{anyLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function SearchBox({ value, onChange }) {
  const [draft, setDraft] = useState(value);

  // Keep the box in step when the filter changes elsewhere — a drill-down, or
  // the back button — without fighting what is being typed.
  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (draft === value) return undefined;
    const timer = setTimeout(() => onChange(draft.trim()), 350);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <label className="filters__field filters__field--grow">
      <span className="sr-only">Search by account name or IP address</span>
      <input
        type="search"
        className="input input--compact"
        placeholder="Account name or IP address"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    </label>
  );
}

/**
 * Whether events are arriving live or being polled.
 *
 * Stated rather than hidden. "Nothing is happening" and "I am no longer being
 * told what is happening" look identical on a dashboard, and on a security
 * console the difference matters enough to spend a line of chrome on.
 */
function LiveIndicator() {
  const { mode, lastEventAt } = useLive();

  const text = mode === 'live' ? 'Live'
    : mode === 'connecting' ? 'Connecting…'
    : 'Polling';

  const detail = mode === 'live'
    ? lastEventAt
      ? `Receiving events as they happen. Last event ${new Date(lastEventAt).toLocaleTimeString()}.`
      : 'Receiving events as they happen.'
    : mode === 'connecting'
      ? 'Opening the live event stream.'
      : 'The live stream is unavailable, so these views refresh on a timer instead.';

  return (
    <span className={`live live--${mode}`} title={detail}>
      <span className="live__dot" aria-hidden="true" />
      <span className="live__text">{text}</span>
      <span className="sr-only">{detail}</span>
    </span>
  );
}
