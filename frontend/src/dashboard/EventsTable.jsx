import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActorBadge, DecisionBadge, RoleBadge, SeverityBadge } from '../components/Badge';
import { EmptyState, Panel } from '../components/States';
import { events as eventsApi } from '../api/endpoints';
import { useFilters } from './FilterContext';
import { useLive } from './LiveContext';
import { useResource } from './useResource';

/*
 * The event feed as a table.
 *
 * ── Paged, sorted and filtered by the service ──
 *
 * Not in the browser. The trail is append-only and grows without limit; sorting
 * it client-side would mean fetching a window large enough to sort, which is
 * either wrong (sorting one page is not sorting the data) or ruinous (fetching
 * a month to sort it). The service has the indexes for this. The table's job is
 * to ask the right question and render the answer.
 *
 * ── The offset is in the URL ──
 *
 * So the back button steps back through pages, and a link to page 3 of a
 * filtered view is a link to page 3 of that filtered view. It is kept separate
 * from the shared filters, which reset it: page 4 of an old result set is not
 * page 4 of a new one, and silently keeping the offset across a filter change
 * is how a narrowed search appears to return nothing.
 */

const PAGE_SIZE = 50;

const SORTABLE = [
  { key: 'time', label: 'Time' },
  { key: 'severity', label: 'Severity' },
  { key: 'eventType', label: 'Event' },
  { key: 'actor', label: 'Account' },
];

export default function EventsTable({
  title = 'Events',
  subtitle,
  extraQuery = {},
  showExport = true,
  readOnlyNote,
}) {
  const { filters, queryFor, clearFilters, activeFilters } = useFilters();
  const { revision } = useLive();
  const [params, setParams] = useSearchParams();

  const offset = Math.max(Number(params.get('offset')) || 0, 0);
  const sort = params.get('sort') || 'time';
  const order = params.get('order') || 'desc';

  const query = queryFor({ ...extraQuery, limit: PAGE_SIZE, offset, sort, order });

  const { data, error, loading, refreshing, reload } = useResource(
    ({ signal }) => eventsApi.list(query, { signal }),
    [JSON.stringify(query), revision]
  );

  const setPage = useCallback((next) => {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next <= 0) updated.delete('offset');
      else updated.set('offset', String(next));
      return updated;
    });
  }, [setParams]);

  const setSort = useCallback((key) => {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      const sameColumn = (current.get('sort') || 'time') === key;
      // Clicking the active column flips the direction; a new column starts
      // descending, which is what "most recent" and "most severe" both mean.
      const nextOrder = sameColumn && (current.get('order') || 'desc') === 'desc' ? 'asc' : 'desc';
      if (key === 'time' && nextOrder === 'desc') updated.delete('sort');
      else updated.set('sort', key);
      if (nextOrder === 'desc') updated.delete('order');
      else updated.set('order', nextOrder);
      updated.delete('offset');
      return updated;
    }, { replace: true });
  }, [setParams]);

  const total = data?.total ?? 0;
  const rows = data?.events ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2 className="card__title">{title}</h2>
          <p className="card__subtitle">
            {subtitle ? `${subtitle} · ` : ''}
            {total.toLocaleString()} event{total === 1 ? '' : 's'}
            {activeFilters.length ? ` matching ${activeFilters.length} filter${activeFilters.length === 1 ? '' : 's'}` : ''}
            {refreshing ? ' · refreshing…' : ''}
          </p>
        </div>
        {showExport && <ExportButton query={query} disabled={!total} />}
      </header>

      {readOnlyNote && <p className="card__note">{readOnlyNote}</p>}

      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={!rows.length}
        loadingRows={8}
        loadingLabel="Loading events…"
        empty={(
          <EmptyState
            title="No events match"
            detail={
              activeFilters.length
                ? 'Nothing in this period matches the current filters. On a security dashboard that is usually good news, but widen the period or clear the filters to be sure.'
                : 'Nothing has been recorded in this period.'
            }
            onClear={activeFilters.length ? clearFilters : undefined}
          />
        )}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {SORTABLE.map((column) => (
                  <th key={column.key} aria-sort={sort === column.key ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="th-sort" onClick={() => setSort(column.key)}>
                      {column.label}
                      {sort === column.key && (
                        <span className="th-sort__arrow" aria-hidden="true">{order === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  </th>
                ))}
                <th>What happened</th>
                <th>Outcome</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => (
                <tr key={event.id}>
                  <td className="nowrap">
                    <time dateTime={event.time} title={new Date(event.time).toISOString()}>
                      {new Date(event.time).toLocaleString()}
                    </time>
                  </td>
                  <td><SeverityBadge severity={event.severity} /></td>
                  <td className="nowrap">{String(event.eventType).replace(/_/g, ' ')}</td>
                  <td>
                    {event.actor ? (
                      <div className="cell-stack">
                        {/* Plain text, never dangerouslySetInnerHTML: names and
                            addresses in the trail are attacker-influenced. */}
                        <span>{event.actor.fullName || 'Unknown account'}</span>
                        <RoleBadge role={event.actor.role} />
                      </div>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td className="cell-explain">{event.explanation}</td>
                  <td>
                    <div className="cell-stack">
                      {event.decision && <DecisionBadge decision={event.decision} />}
                      <ActorBadge actorType={event.actorType} />
                    </div>
                  </td>
                  <td className="mono">{event.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <nav className="pager" aria-label="Pages of events">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => setPage(offset - PAGE_SIZE)}
            disabled={offset === 0}
          >
            Previous
          </button>
          <span className="pager__status small secondary">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => setPage(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
          >
            Next
          </button>
        </nav>
      </Panel>
    </section>
  );
}

/**
 * Export what is on screen.
 *
 * The same filters, so the file matches the view rather than being a fresh
 * unfiltered dump. The service records the export as its own action, because a
 * copy of the security history in a file outlives every access control this
 * system has — and the button says so, rather than leaving that implicit.
 */
function ExportButton({ query, disabled }) {
  const [state, setState] = useState('idle');

  const run = async () => {
    setState('working');
    try {
      // The offset and page size belong to the table, not the export: the file
      // is the whole filtered result, not the page being looked at.
      const { limit, offset, ...rest } = query;
      const { blob, filename } = await eventsApi.exportCsv(rest);

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoked on the next tick: revoking immediately can cancel the download
      // in some browsers before it has started reading the blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState('done');
      setTimeout(() => setState('idle'), 3000);
    } catch {
      setState('failed');
      setTimeout(() => setState('idle'), 4000);
    }
  };

  return (
    <button
      type="button"
      className="btn btn--outline btn--sm"
      onClick={run}
      disabled={disabled || state === 'working'}
      title="Downloads the filtered events as a CSV file. The download is recorded in the audit log."
    >
      {state === 'working' ? 'Preparing…'
        : state === 'done' ? 'Downloaded'
        : state === 'failed' ? 'Export failed'
        : 'Export CSV'}
    </button>
  );
}
