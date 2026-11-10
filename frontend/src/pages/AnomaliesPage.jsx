import { useState } from 'react';
import FilterBar from '../dashboard/FilterBar';
import AnomalyHistogram from '../charts/AnomalyHistogram';
import BreakdownBars from '../charts/BreakdownBars';
import AnomalyDetail from '../dashboard/AnomalyDetail';
import { ActionBadge, RoleBadge } from '../components/Badge';
import { EmptyState, Panel } from '../components/States';
import { anomalies as anomaliesApi } from '../api/endpoints';
import { useFilters } from '../dashboard/FilterContext';
import { useLive } from '../dashboard/LiveContext';
import { useInterval, useResource } from '../dashboard/useResource';

/*
 * Anomaly review: the distribution, where the concerns came from, and the queue.
 *
 * The queue defaults to flagged-only. An 'allow' is the overwhelming majority
 * of scored sign-ins and is not what anyone is here to review; showing them by
 * default would bury the handful of rows that matter under hundreds that do
 * not. The toggle is there because "what did the model let through" is a real
 * question — just not the first one.
 */
export default function AnomaliesPage() {
  const { filters, queryFor } = useFilters();
  const { revision, isLive } = useLive();
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const [selected, setSelected] = useState(null);

  const distQuery = { window: filters.window, from: filters.from, to: filters.to, role: filters.role };
  const distribution = useResource(
    ({ signal }) => anomaliesApi.distribution(clean(distQuery), { signal }),
    [JSON.stringify(distQuery), revision]
  );

  const listQuery = queryFor({
    limit: 50,
    flaggedOnly: flaggedOnly ? 'true' : undefined,
    // Severity and the free-text search belong to the event feed's vocabulary,
    // not the anomaly table's — it has no severity column, and passing one
    // would be a 400 from a service that validates strictly rather than
    // ignoring what it does not recognise.
    severity: undefined,
    eventType: undefined,
    layer: undefined,
  });
  const list = useResource(
    ({ signal }) => anomaliesApi.list(listQuery, { signal }),
    [JSON.stringify(listQuery), revision]
  );

  useInterval(() => { distribution.reload(); list.reload(); }, 60_000, { enabled: !isLive });

  return (
    <>
      <FilterBar show={['window', 'role', 'search']} />

      <div className="stack">
        <Panel
          loading={distribution.loading}
          error={distribution.error}
          onRetry={distribution.reload}
          loadingLabel="Loading the score distribution…"
        >
          <AnomalyHistogram data={distribution.data} />

          <div className="chart-grid" style={{ marginTop: 'var(--s4)' }}>
            <BreakdownBars
              title="Where the concerns came from"
              subtitle="Events needing attention, by the defence that recorded them"
              footnote="The bar counts events of medium severity or above, plus outright refusals. The resource layer handles the most traffic by far and almost none of it is interesting, so raw volume would say nothing about where attention is needed."
              rows={(distribution.data?.byLayer || []).map((row) => ({
                key: row.layer,
                label: row.label,
                description: row.description,
                value: row.ofConcern,
                total: row.total,
              }))}
            />

            <BreakdownBars
              title="By account type"
              subtitle="Which kinds of account the concerns involved"
              footnote="Counted the same way. A high count against one account type is not itself a problem — there are far more family members than administrators — so read it next to the total."
              rows={(distribution.data?.byRole || []).map((row) => ({
                key: row.role,
                label: row.role === 'unknown' ? 'No account recorded' : capitalise(row.role),
                description: `${row.accounts} account${row.accounts === 1 ? '' : 's'} involved`,
                value: row.ofConcern,
                total: row.total,
              }))}
            />
          </div>
        </Panel>

        <section className="card">
          <header className="card__header">
            <div>
              <h2 className="card__title">Review queue</h2>
              <p className="card__subtitle">
                {(list.data?.total ?? 0).toLocaleString()} scored sign-in
                {list.data?.total === 1 ? '' : 's'}
                {flaggedOnly ? ' that were not simply allowed' : ''}
              </p>
            </div>
            <label className="row small">
              <input
                type="checkbox"
                checked={!flaggedOnly}
                onChange={(e) => setFlaggedOnly(!e.target.checked)}
              />
              <span>Include allowed sign-ins</span>
            </label>
          </header>

          <Panel
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            isEmpty={!list.data?.anomalies?.length}
            loadingRows={6}
            empty={(
              <EmptyState
                title={flaggedOnly ? 'Nothing flagged' : 'No sign-ins scored'}
                detail={flaggedOnly
                  ? 'Every scored sign-in in this period was allowed. Widen the period, or include allowed sign-ins, to see what the model has been seeing.'
                  : 'No sign-in attempts were scored in this period.'}
              />
            )}
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th className="num">Score</th>
                    <th>Decision</th>
                    <th>Account</th>
                    <th>Why it stood out</th>
                    <th>From</th>
                    <th><span className="sr-only">Detail</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(list.data?.anomalies || []).map((anomaly) => (
                    <tr key={anomaly.id}>
                      <td className="nowrap">
                        <time dateTime={anomaly.time}>
                          {new Date(anomaly.time).toLocaleString()}
                        </time>
                      </td>
                      <td className="num">
                        {anomaly.riskScore === null ? '—' : anomaly.riskScore.toFixed(1)}
                      </td>
                      <td>
                        <div className="cell-stack">
                          <ActionBadge action={anomaly.decision.action} />
                          <span className="small muted">
                            {anomaly.decision.governedBy === 'model' ? 'by the model' : 'by a rule'}
                          </span>
                        </div>
                      </td>
                      <td>
                        {anomaly.account ? (
                          <div className="cell-stack">
                            <span>{anomaly.account.fullName}</span>
                            <RoleBadge role={anomaly.account.role} />
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="cell-explain">{anomaly.explanation}</td>
                      <td className="small">
                        {[anomaly.origin.city, anomaly.origin.country].filter(Boolean).join(', ') || '—'}
                        <br />
                        <span className="mono muted">{anomaly.origin.ip}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          onClick={() => setSelected(anomaly)}
                        >
                          Examine
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      </div>

      {selected && (
        <AnomalyDetail
          anomaly={selected}
          thresholds={distribution.data?.thresholds}
          onClose={() => setSelected(null)}
          // A recorded verdict changes the queue and the review statistics, so
          // both are reloaded rather than left showing the state before it.
          onReviewed={() => { list.reload(); distribution.reload(); }}
        />
      )}
    </>
  );
}

const capitalise = (value) => String(value).charAt(0).toUpperCase() + String(value).slice(1);

/** Drop empty values so a strict validator does not see `role: ''`. */
function clean(object) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
}
