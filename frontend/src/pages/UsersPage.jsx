import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AccountDetail from '../dashboard/AccountDetail';
import { AccountStatusBadge, RoleBadge } from '../components/Badge';
import { EmptyState, Panel } from '../components/States';
import { accounts as accountsApi } from '../api/endpoints';
import { ROLES } from '../dashboard/FilterContext';
import { useResource } from '../dashboard/useResource';

/*
 * The accounts on the service.
 *
 * Not windowed, for the same reason the session list is not: an account exists
 * whether or not it did anything in the last 24 hours, and a list that hid the
 * dormant ones would hide the account nobody has touched since it was frozen.
 *
 * The selected account is in the query string rather than in component state,
 * so a link to one account's detail is a link an administrator can paste into a
 * ticket — which is how most of these investigations actually get handed over.
 */

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'frozen', label: 'Frozen' },
];

export default function UsersPage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get('search') || '');

  const role = params.get('role') || '';
  const status = params.get('status') || '';
  const search = params.get('search') || '';
  const selected = params.get('userId');

  const query = {
    limit: 100,
    ...(role && { role }),
    ...(status && { status }),
    ...(search && { search }),
  };

  const { data, error, loading, reload } = useResource(
    ({ signal }) => accountsApi.list(query, { signal }),
    [JSON.stringify(query)]
  );

  const setParam = (key, value) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (!value) next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });

  const rows = data?.accounts || [];

  return (
    <>
      <div className="filters">
        <div className="filters__fields">
          <label className="filters__field">
            <span className="sr-only">Account type</span>
            <select
              className="select select--compact"
              value={role}
              onChange={(e) => setParam('role', e.target.value)}
            >
              <option value="">Any account type</option>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>

          <label className="filters__field">
            <span className="sr-only">Standing</span>
            <select
              className="select select--compact"
              value={status}
              onChange={(e) => setParam('status', e.target.value)}
            >
              <option value="">Any standing</option>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>

          <form
            className="filters__field filters__field--grow"
            onSubmit={(e) => { e.preventDefault(); setParam('search', draft.trim()); }}
          >
            <span className="sr-only">Search by name, phone number or email</span>
            <input
              type="search"
              className="input input--compact"
              placeholder="Name, phone number or email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </form>

          {(role || status || search) && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => { setDraft(''); setParams(new URLSearchParams(), { replace: true }); }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <header className="card__header">
          <div>
            <h2 className="card__title">Accounts</h2>
            <p className="card__subtitle">
              {(data?.total ?? 0).toLocaleString()} account{data?.total === 1 ? '' : 's'}
            </p>
          </div>
        </header>

        <p className="card__note">
          Phone numbers are masked. Searching by a full number still works — an administrator handed
          a number by someone reporting a problem has to be able to find the account; the masking is
          about not producing a list of every subscriber's number.
        </p>

        <Panel
          loading={loading}
          error={error}
          onRetry={reload}
          isEmpty={!rows.length}
          loadingRows={8}
          empty={(
            <EmptyState
              title="No accounts match"
              detail="Nothing matches these filters. Clear them to see every account."
              onClear={role || status || search
                ? () => { setDraft(''); setParams(new URLSearchParams(), { replace: true }); }
                : undefined}
            />
          )}
        >
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Standing</th>
                  <th>Last sign-in</th>
                  <th className="num">Events</th>
                  <th className="num">Of concern</th>
                  <th className="num">Signed in</th>
                  <th><span className="sr-only">Detail</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <div className="cell-stack">
                        <span>{account.fullName || 'No name recorded'}</span>
                        <span className="mono small muted">{account.phoneNumber}</span>
                      </div>
                    </td>
                    <td><RoleBadge role={account.role} /></td>
                    <td>
                      <div className="cell-stack">
                        <AccountStatusBadge status={account.accountStatus} />
                        {/* A lock is not a standing — it expires on its own —
                            so it is shown beside the standing, not instead. */}
                        {account.lockedUntil && (
                          <span className="badge badge--medium" title={`Locked until ${new Date(account.lockedUntil).toLocaleString()}`}>
                            <span className="badge__dot" aria-hidden="true" />
                            Locked
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="small nowrap">
                      {account.lastLogin ? (
                        <>
                          {new Date(account.lastLogin.at).toLocaleString()}
                          {(account.lastLogin.city || account.lastLogin.country) && (
                            <>
                              <br />
                              <span className="muted">
                                {[account.lastLogin.city, account.lastLogin.country]
                                  .filter(Boolean).join(', ')}
                              </span>
                            </>
                          )}
                        </>
                      ) : <span className="muted">never</span>}
                    </td>
                    <td className="num">{account.events}</td>
                    <td className="num">
                      {account.urgentEvents > 0
                        ? <strong>{account.urgentEvents}</strong>
                        : <span className="muted">0</span>}
                    </td>
                    <td className="num">
                      {account.activeSessions > 0 ? account.activeSessions : <span className="muted">—</span>}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={() => setParam('userId', account.id)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>

      {selected && (
        <AccountDetail
          accountId={selected}
          onClose={() => setParam('userId', '')}
          onChanged={reload}
        />
      )}
    </>
  );
}
