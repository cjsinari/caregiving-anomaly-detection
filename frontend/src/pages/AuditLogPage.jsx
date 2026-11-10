import FilterBar from '../dashboard/FilterBar';
import EventsTable from '../dashboard/EventsTable';
import { useFilters } from '../dashboard/FilterContext';

/*
 * The audit log viewer.
 *
 * ── Read-only by construction, not by omission ──
 *
 * There are no edit or delete controls here, and that is not because the
 * interface chose to leave them out. `audit_logs` has a trigger that refuses
 * every DELETE and refuses every UPDATE other than the foreign keys being
 * nulled when an account is removed. The service has no endpoint that could
 * modify a row, so there is nothing for a button to call — an administrator
 * cannot erase the record of their own action even if they find a way past the
 * interface, which is the only version of this guarantee worth having.
 *
 * ── Why this is a separate view from the event feed ──
 *
 * They read the same table. The difference is the question being asked. The
 * event feed is "what is happening on the service"; this is "who did what, and
 * on whose authority" — so it defaults to the longer window and to the acts
 * with a decision-maker behind them, which is what an incident review or an
 * access-accounting request actually needs.
 */
export default function AuditLogPage() {
  const { filters, setFilters } = useFilters();

  // Administrator actions and automated decisions are what distinguish this
  // view from the feed; the filter is a default rather than a constraint,
  // because "and what else happened at that moment" is the next question.
  const actorType = filters.actorType || '';

  return (
    <>
      <FilterBar show={['window', 'severity', 'role', 'search']} />

      <div className="filters" style={{ marginTop: 'calc(var(--s5) * -1 + var(--s3))' }}>
        <div className="segmented" role="group" aria-label="Who acted">
          {[
            { value: '', label: 'Everything' },
            { value: 'administrator', label: 'Administrator actions' },
            { value: 'automated', label: 'Automated decisions' },
            { value: 'user', label: 'Account holders' },
          ].map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              className={`segmented__option${actorType === option.value ? ' segmented__option--on' : ''}`}
              onClick={() => setFilters({ actorType: option.value })}
              aria-pressed={actorType === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <EventsTable
        title="Audit log"
        subtitle="Append-only"
        readOnlyNote={
          'This log cannot be edited or deleted — not by hiding the controls, but because the '
          + 'table itself refuses it: a database trigger rejects every delete and every change to '
          + 'a recorded event. An administrator cannot erase the record of their own action. '
          + 'Exporting is recorded here too, since a copy in a file outlives any access control '
          + 'this service has.'
        }
      />
    </>
  );
}
