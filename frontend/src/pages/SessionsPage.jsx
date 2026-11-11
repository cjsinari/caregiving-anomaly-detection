import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ConfirmAction from '../dashboard/ConfirmAction';
import { AccountStatusBadge, RoleBadge, SessionStatusBadge } from '../components/Badge';
import { EmptyState, Panel } from '../components/States';
import { sessions as sessionsApi } from '../api/endpoints';
import { useLive } from '../dashboard/LiveContext';
import { useInterval, useResource } from '../dashboard/useResource';

/*
 * Who is signed in, and the controls to do something about it.
 *
 * ── The cache column ──
 *
 * Each row says whether Redis still holds the session. That is not an
 * implementation detail leaking into the interface: it is how an administrator
 * knows a revoke actually took effect. The database row and the cache are
 * updated by the same operation, but the cache is what the authentication path
 * checks first, so "ended in the database, still live in Redis" is the state
 * where a revoked token keeps working — and the one state an administrator
 * ending someone's session needs to be able to rule out.
 *
 * ── Not windowed ──
 *
 * "Signed in now" is a fact about the present, so this view ignores the shared
 * time window. A session that started last week and is still live belongs in
 * it; filtering by the window would hide exactly the long-lived sessions most
 * worth looking at.
 */

const STATUSES = [
  { value: 'active', label: 'Active now' },
  { value: 'flagged', label: 'Ended by a detector' },
  { value: 'invalidated', label: 'Signed out' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
];

export default function SessionsPage() {
  const [params, setParams] = useSearchParams();
  const { revision, isLive } = useLive();
  const [ending, setEnding] = useState(null);

  const status = params.get('status') || 'active';
  const search = params.get('search') || '';
  const role = params.get('role') || '';

  const query = { status, limit: 100, ...(search && { search }), ...(role && { role }) };
  const { data, error, loading, reload } = useResource(
    ({ signal }) => sessionsApi.list(query, { signal }),
    [JSON.stringify(query), revision]
  );

  useInterval(() => reload(), 45_000, { enabled: !isLive });

  const setParam = (key, value) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (!value) next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });

  const rows = data?.sessions || [];

  return (
    <>
      <div className="filters">
        <div className="segmented" role="group" aria-label="Session state">
          {STATUSES.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`segmented__option${status === option.value ? ' segmented__option--on' : ''}`}
              onClick={() => setParam('status', option.value === 'active' ? '' : option.value)}
              aria-pressed={status === option.value}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="filters__fields">
          <label className="filters__field filters__field--grow">
            <span className="sr-only">Search by account name or address</span>
            <input
              type="search"
              className="input input--compact"
              placeholder="Account name or IP address"
              defaultValue={search}
              onBlur={(e) => setParam('search', e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter') setParam('search', e.target.value.trim()); }}
            />
          </label>
        </div>

        {data?.cache && data.cache.available === false && (
          <span className="badge badge--medium" title="Live-session state could not be read from Redis">
            <span className="badge__dot" aria-hidden="true" />
            Cache unavailable
          </span>
        )}
      </div>

      <section className="card">
        <header className="card__header">
          <div>
            <h2 className="card__title">Sessions</h2>
            <p className="card__subtitle">
              {(data?.total ?? 0).toLocaleString()} session{data?.total === 1 ? '' : 's'}
              {status === 'active' ? ' signed in right now' : ''}
            </p>
          </div>
        </header>

        <p className="card__note">
          Ending a session takes effect immediately — the Redis entry is dropped as well as the
          database row updated, so the next request on that token is refused rather than waiting
          for it to expire. It does not touch the account itself.
        </p>

        <Panel
          loading={loading}
          error={error}
          onRetry={reload}
          isEmpty={!rows.length}
          loadingRows={6}
          empty={(
            <EmptyState
              title={status === 'active' ? 'Nobody is signed in' : 'No sessions match'}
              detail={status === 'active'
                ? 'No account currently holds an active session.'
                : 'No sessions in this state. Try another state, or clear the search.'}
            />
          )}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>State</th>
                  <th>Device and address</th>
                  <th>Started</th>
                  <th>Last seen</th>
                  <th className="num">Risk</th>
                  <th>Cache</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((session) => (
                  <tr key={session.id}>
                    <td>
                      <div className="cell-stack">
                        <Link to={`/users?userId=${session.account.id}`}>
                          {session.account.fullName}
                        </Link>
                        <span className="row">
                          <RoleBadge role={session.account.role} />
                          {session.account.accountStatus !== 'active' && (
                            <AccountStatusBadge status={session.account.accountStatus} />
                          )}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-stack">
                        <SessionStatusBadge status={session.status} />
                        {session.flagged && (
                          <span className="small muted">
                            {String(session.flagged.reason).replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="small">
                      <span className="mono">{session.device.ip || '—'}</span>
                      {session.device.lastSeenIp && session.device.lastSeenIp !== session.device.ip && (
                        <>
                          <br />
                          <span className="muted">then </span>
                          <span className="mono">{session.device.lastSeenIp}</span>
                        </>
                      )}
                      <br />
                      <span className="muted truncate" title={session.device.fingerprint || ''}>
                        {session.device.fingerprint || 'no device id'}
                      </span>
                    </td>
                    <td className="nowrap small">{new Date(session.startedAt).toLocaleString()}</td>
                    <td className="nowrap small">
                      {session.lastSeenAt
                        ? new Date(session.lastSeenAt).toLocaleString()
                        : <span className="muted">not since starting</span>}
                    </td>
                    <td className="num">
                      {session.riskScore === null ? '—' : session.riskScore.toFixed(1)}
                    </td>
                    <td className="small">
                      {session.cache.cached === null ? <span className="muted">unknown</span>
                        : session.cache.cached
                          ? <span title={`Redis holds this session for another ${Math.round(session.cache.ttlSeconds / 60)} minutes`}>held</span>
                          : <span className="muted" title="Redis no longer holds this session; the next request falls through to the database">dropped</span>}
                    </td>
                    <td>
                      {session.status === 'active' && (
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          onClick={() => setEnding(session)}
                        >
                          End session
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {ending && (
        <ConfirmAction
          title="End this session?"
          verb="End session"
          consequence={
            `${ending.account.fullName} will be signed out immediately on the device at `
            + `${ending.device.ip || 'an unrecorded address'}. Their account is not changed — they `
            + 'can sign in again straight away. Use a lock or a freeze if that is not what you want.'
          }
          onConfirm={({ reason }) => sessionsApi.block(ending.id, reason)}
          onClose={() => { setEnding(null); reload(); }}
        />
      )}
    </>
  );
}
