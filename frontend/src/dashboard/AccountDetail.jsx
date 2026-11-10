import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ConfirmAction from './ConfirmAction';
import { AccountStatusBadge, RoleBadge, SeverityBadge, SessionStatusBadge } from '../components/Badge';
import { Panel } from '../components/States';
import { accounts as accountsApi, sessions as sessionsApi } from '../api/endpoints';
import { useResource } from './useResource';
import './detail.css';

/*
 * One account: its standing, its security history, and what can be done about it.
 *
 * ── The four responses, in order ──
 *
 * Presented least to most severe, with what each one costs the account holder
 * stated on the button. That ordering is the point: the instinct when something
 * looks wrong at 2am is to reach for the biggest lever, and an indefinite
 * freeze on a false positive locks a family member out of their relative's care
 * record until someone else undoes it.
 *
 *   step-up    next sign-in proves itself; sessions keep running
 *   lock       no new sign-ins for a set period, then clears itself
 *   freeze     indefinite, ends live sessions, needs undoing by hand
 *   restore    lifts a freeze or a suspension
 *
 * ── No care records ──
 *
 * The service refuses administrators access to care records, so this panel does
 * not list the profiles an account owns. A detail page that named the elderly
 * people behind an account would hand over through the back door exactly what
 * the authorization layer refuses at the front. What is here is the account's
 * security posture, which is what the role is for.
 */
export default function AccountDetail({ accountId, onClose, onChanged }) {
  const [action, setAction] = useState(null);
  const [endingSession, setEndingSession] = useState(null);
  const closeButton = useRef(null);

  const { data, error, loading, reload } = useResource(
    ({ signal }) => accountsApi.get(accountId, { signal }),
    [accountId]
  );

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event) => {
      // Only close the panel when no dialog is stacked on top of it: Escape
      // should dismiss the thing that was opened last.
      if (event.key === 'Escape' && !action && !endingSession) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, action, endingSession]);

  const account = data?.account;
  const risk = data?.riskSummary;

  const afterAction = () => { reload(); onChanged?.(); };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay__panel" role="dialog" aria-modal="true" aria-labelledby="account-detail-title">
        <header className="overlay__header">
          <div>
            <h2 className="overlay__title" id="account-detail-title">
              {account?.fullName || 'Account'}
            </h2>
            <p className="overlay__subtitle">
              {account ? `${account.phoneNumber} · joined ${new Date(account.createdAt).toLocaleDateString()}` : accountId}
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} ref={closeButton}>
            Close<span className="sr-only"> account detail</span>
          </button>
        </header>

        <div className="overlay__body">
          <Panel loading={loading} error={error} onRetry={reload} loadingLabel="Loading the account…">
            {account && (
              <>
                <section className="detail-block">
                  <h3 className="detail-block__title">Standing</h3>
                  <div className="row row--wrap">
                    <RoleBadge role={account.role} />
                    <AccountStatusBadge status={account.accountStatus} />
                    {account.lockedUntil && (
                      <span className="badge badge--medium">
                        <span className="badge__dot" aria-hidden="true" />
                        Locked until {new Date(account.lockedUntil).toLocaleTimeString()}
                      </span>
                    )}
                    {!account.phoneVerified && (
                      <span className="badge badge--neutral">Phone not verified</span>
                    )}
                  </div>

                  <dl className="facts" style={{ marginTop: 'var(--s4)' }}>
                    <div className="facts__item">
                      <dt className="facts__label">Last sign-in</dt>
                      <dd className="facts__value">
                        {account.lastLogin
                          ? `${new Date(account.lastLogin.at).toLocaleString()}${
                            account.lastLogin.city ? ` · ${account.lastLogin.city}, ${account.lastLogin.country}` : ''}`
                          : 'Never signed in'}
                      </dd>
                    </div>
                    <div className="facts__item">
                      <dt className="facts__label">Signed in now</dt>
                      <dd className="facts__value">{account.activeSessions} session(s)</dd>
                    </div>
                    <div className="facts__item">
                      <dt className="facts__label">Recorded events</dt>
                      <dd className="facts__value">
                        {account.events}
                        {account.urgentEvents > 0 && ` · ${account.urgentEvents} high or critical`}
                      </dd>
                    </div>
                    <div className="facts__item">
                      <dt className="facts__label">Identity verification</dt>
                      <dd className="facts__value">{account.verificationStatus}</dd>
                    </div>
                  </dl>
                </section>

                {risk && (
                  <section className="detail-block">
                    <h3 className="detail-block__title">Risk summary · last {risk.periodDays} days</h3>
                    <dl className="facts">
                      <div className="facts__item">
                        <dt className="facts__label">Sign-ins scored</dt>
                        <dd className="facts__value">{risk.scored}</dd>
                      </div>
                      <div className="facts__item">
                        <dt className="facts__label">Blocked</dt>
                        <dd className="facts__value">{risk.blocked}</dd>
                      </div>
                      <div className="facts__item">
                        <dt className="facts__label">Step-up required</dt>
                        <dd className="facts__value">{risk.steppedUp}</dd>
                      </div>
                      <div className="facts__item">
                        <dt className="facts__label">Average score</dt>
                        <dd className="facts__value">{risk.averageScore ?? '—'}</dd>
                      </div>
                      <div className="facts__item">
                        <dt className="facts__label">Highest score</dt>
                        <dd className="facts__value">{risk.highestScore ?? '—'}</dd>
                      </div>
                      <div className="facts__item">
                        <dt className="facts__label">Countries seen</dt>
                        <dd className="facts__value">{risk.countriesSeen}</dd>
                      </div>
                      <div className="facts__item">
                        <dt className="facts__label">Failed attempts</dt>
                        <dd className="facts__value">{risk.failedAttempts}</dd>
                      </div>
                      <div className="facts__item">
                        <dt className="facts__label">Flags reviewed</dt>
                        <dd className="facts__value">
                          {risk.truePositives + risk.falsePositives === 0
                            ? 'none reviewed'
                            : `${risk.truePositives} correct, ${risk.falsePositives} wrong`}
                        </dd>
                      </div>
                    </dl>
                    {risk.falsePositives > 0 && (
                      <p className="detail-note">
                        {risk.falsePositives} flag{risk.falsePositives === 1 ? '' : 's'} on this
                        account {risk.falsePositives === 1 ? 'was' : 'were'} reviewed and found to
                        be wrong. Worth weighing before acting on another one.
                      </p>
                    )}
                  </section>
                )}

                {/* The actions, least severe first. */}
                <section className="detail-block">
                  <h3 className="detail-block__title">Response</h3>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn--outline"
                      onClick={() => setAction('stepUp')}
                    >
                      Require extra verification
                    </button>
                    <button
                      type="button"
                      className="btn btn--outline"
                      onClick={() => setAction('lock')}
                      disabled={account.accountStatus === 'frozen'}
                    >
                      Lock temporarily
                    </button>
                    {account.accountStatus === 'frozen' || account.accountStatus === 'suspended' ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => setAction('restore')}
                      >
                        Restore access
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => setAction('freeze')}
                        disabled={account.role === 'administrator'}
                        title={account.role === 'administrator'
                          ? 'Administrator accounts are protected from this by the security policy'
                          : undefined}
                      >
                        Freeze account
                      </button>
                    )}
                  </div>
                  <p className="detail-note">
                    Every response requires a reason, which is stored with it and appears in the
                    audit log against your account. Extra verification and a lock leave live
                    sessions running; a freeze ends them.
                  </p>
                </section>

                {data.sessions.length > 0 && (
                  <section className="detail-block">
                    <h3 className="detail-block__title">Sessions</h3>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>State</th>
                            <th>Address</th>
                            <th>Started</th>
                            <th className="num">Risk</th>
                            <th><span className="sr-only">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.sessions.map((session) => (
                            <tr key={session.id}>
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
                              <td className="mono small">{session.device.ip || '—'}</td>
                              <td className="small nowrap">
                                {new Date(session.startedAt).toLocaleString()}
                              </td>
                              <td className="num">
                                {session.riskScore === null ? '—' : session.riskScore.toFixed(1)}
                              </td>
                              <td>
                                {session.status === 'active' && (
                                  <button
                                    type="button"
                                    className="btn btn--outline btn--sm"
                                    onClick={() => setEndingSession(session)}
                                  >
                                    End
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {data.trustedDevices.length > 0 && (
                  <section className="detail-block">
                    <h3 className="detail-block__title">
                      Trusted devices ({data.trustedDevices.length})
                    </h3>
                    <ul className="history">
                      {data.trustedDevices.map((device) => (
                        <li key={device.id} className="history__item">
                          <span className="small">{device.label || 'Unlabelled device'}</span>
                          <span className="small secondary">
                            trusted {new Date(device.trustedAt).toLocaleDateString()}
                          </span>
                          <span className="small muted">
                            {device.lastSeenAt
                              ? `last used ${new Date(device.lastSeenAt).toLocaleDateString()}`
                              : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="detail-note">
                      A sign-in from one of these is not challenged. "Require extra verification"
                      removes them all.
                    </p>
                  </section>
                )}

                <section className="detail-block">
                  <h3 className="detail-block__title">Security history</h3>
                  <ul className="history history--events">
                    {data.history.map((event) => (
                      <li key={event.id} className="history__event">
                        <div className="history__event-head">
                          <SeverityBadge severity={event.severity} />
                          <span className="small">{String(event.eventType).replace(/_/g, ' ')}</span>
                          <time className="small muted push" dateTime={event.time}>
                            {new Date(event.time).toLocaleString()}
                          </time>
                        </div>
                        {/* Plain text: an explanation can contain values that
                            came from a request. */}
                        <p className="history__event-why">{event.explanation}</p>
                      </li>
                    ))}
                  </ul>
                  <div className="row" style={{ marginTop: 'var(--s4)' }}>
                    <Link
                      className="btn btn--outline btn--sm"
                      to={`/events?userId=${accountId}`}
                      onClick={onClose}
                    >
                      All events for this account
                    </Link>
                    <Link
                      className="btn btn--outline btn--sm"
                      to={`/anomalies?userId=${accountId}`}
                      onClick={onClose}
                    >
                      Its scored sign-ins
                    </Link>
                  </div>
                </section>
              </>
            )}
          </Panel>
        </div>
      </div>

      {action === 'stepUp' && (
        <ConfirmAction
          title="Require extra verification?"
          verb="Require verification"
          destructive={false}
          consequence={
            `${account.fullName}'s trusted devices will be removed, so their next sign-in from any `
            + 'device needs a second code. Sessions they already have keep working. This is the '
            + 'right response to a reported lost or stolen phone.'
          }
          onConfirm={({ reason }) => accountsApi.requireStepUp(accountId, reason)}
          onClose={() => { setAction(null); afterAction(); }}
        />
      )}

      {action === 'lock' && <LockDialog account={account} accountId={accountId}
        onClose={() => { setAction(null); afterAction(); }} />}

      {action === 'freeze' && (
        <ConfirmAction
          title="Freeze this account?"
          verb="Freeze account"
          consequence={
            `${account.fullName} will be signed out of every device and will not be able to sign `
            + 'in again until an administrator restores the account. They are notified by SMS. '
            + 'A freeze does not expire — if you are not certain, a temporary lock does.'
          }
          onConfirm={({ reason }) => accountsApi.freeze(accountId, reason)}
          onClose={() => { setAction(null); afterAction(); }}
        />
      )}

      {action === 'restore' && (
        <ConfirmAction
          title="Restore access?"
          verb="Restore access"
          destructive={false}
          consequence={
            `${account.fullName} will be able to sign in again. Their sessions are not brought `
            + 'back — they will need to sign in fresh, which is what you want after a freeze.'
          }
          onConfirm={({ reason }) => accountsApi.restore(accountId, reason)}
          onClose={() => { setAction(null); afterAction(); }}
        />
      )}

      {endingSession && (
        <ConfirmAction
          title="End this session?"
          verb="End session"
          consequence={
            `The device at ${endingSession.device.ip || 'an unrecorded address'} is signed out `
            + 'immediately. The account itself is unchanged and can sign in again straight away.'
          }
          onConfirm={({ reason }) => sessionsApi.block(endingSession.id, reason)}
          onClose={() => { setEndingSession(null); afterAction(); }}
        />
      )}
    </div>
  );
}

/**
 * The lock dialog carries a duration, which the others do not.
 *
 * A separate component only because it holds that extra field; the confirmation
 * behaviour, the reason requirement and the keyboard handling all come from
 * ConfirmAction rather than being written twice.
 */
function LockDialog({ account, accountId, onClose }) {
  const [minutes, setMinutes] = useState(30);

  return (
    <ConfirmAction
      title="Lock this account temporarily?"
      verb={`Lock for ${minutes} minutes`}
      consequence={
        `${account.fullName} will not be able to sign in for ${minutes} minutes, after which the `
        + 'lock clears itself with no further action. Sessions they already have keep working, and '
        + 'their account standing is unchanged.'
      }
      extraFields={(
        <label className="field confirm__duration">
          <span className="field__label">How long</span>
          <select
            className="select"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={180}>3 hours</option>
            <option value={720}>12 hours</option>
            <option value={1440}>24 hours</option>
          </select>
          <span className="field__hint">
            The lock expires on its own. For something indefinite, use a freeze.
          </span>
        </label>
      )}
      onConfirm={({ reason }) => accountsApi.lock(accountId, reason, minutes)}
      onClose={onClose}
    />
  );
}
