import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ActionBadge, RoleBadge } from '../components/Badge';
import { Panel } from '../components/States';
import { ApiError } from '../api/client';
import { anomalies as anomaliesApi, events as eventsApi } from '../api/endpoints';
import { useResource } from './useResource';
import './detail.css';

/*
 * One anomaly, explained.
 *
 * This is the screen the acceptance criterion is about: every flagged event has
 * to carry an explanation a non-technical administrator can follow. So the
 * order is deliberate — the sentence first, the signals that produced it next,
 * the raw numbers last and collapsed.
 *
 * ── What the signal table does and does not claim ──
 *
 * It says which inputs were outside their normal range, with the observed value
 * and why that range matters. It does not claim those inputs caused the score,
 * and the panel says so in as many words. An Isolation Forest score cannot be
 * decomposed into per-feature contributions; presenting it as if it could would
 * give an administrator a confident account of the model's reasoning that the
 * model never provided — and they would make decisions about real people's
 * accounts on the strength of it.
 *
 * ── Why the recent history is here ──
 *
 * "Unfamiliar country" means something different for an account that signs in
 * from one city every day than for one that moves constantly. The last
 * sign-ins for this account are shown next to the signals so the baseline the
 * model was comparing against is visible, rather than being something the
 * administrator has to take on faith.
 */
export default function AnomalyDetail({ anomaly, thresholds, onClose, onReviewed }) {
  const panel = useRef(null);
  const closeButton = useRef(null);

  // Focus moves into the dialog on open and Escape closes it: a modal that
  // cannot be left by keyboard is a trap.
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const accountId = anomaly.account?.id;
  const history = useResource(
    ({ signal }) => eventsApi.list({
      userId: accountId, window: '30d', limit: 10,
      eventType: 'login_success',
    }, { signal }),
    [accountId],
    { enabled: Boolean(accountId) }
  );

  const contributed = (anomaly.signals || []).filter((s) => s.contributed);
  const normal = (anomaly.signals || []).filter((s) => !s.contributed);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="anomaly-detail-title"
        ref={panel}
      >
        <header className="overlay__header">
          <div>
            <h2 className="overlay__title" id="anomaly-detail-title">
              Sign-in scored {anomaly.riskScore === null ? '—' : anomaly.riskScore.toFixed(1)}
            </h2>
            <p className="overlay__subtitle">
              {new Date(anomaly.time).toLocaleString()}
              {anomaly.account ? ` · ${anomaly.account.fullName}` : ''}
            </p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} ref={closeButton}>
            Close<span className="sr-only"> anomaly detail</span>
          </button>
        </header>

        <div className="overlay__body">
          {/* The headline: the engine's own sentence, as recorded. */}
          <section className="detail-block detail-block--lead">
            <h3 className="detail-block__title">What the service concluded</h3>
            <p className="detail-lead">{anomaly.explanation}</p>
            <div className="row row--wrap" style={{ marginTop: 'var(--s3)' }}>
              <ActionBadge action={anomaly.decision.action} />
              <span className="small secondary">
                decided by {anomaly.decision.governedBy === 'model'
                  ? 'the anomaly model'
                  : `a deterministic rule (${String(anomaly.decision.governedBy).replace(/_/g, ' ')})`}
              </span>
            </div>

            {/* Three conditions that change how much the score is worth, each
                stated rather than left for the reader to infer from a flag. */}
            {anomaly.decision.coldStart && (
              <p className="detail-caveat">
                This account had no behavioural baseline yet, so the model had little to compare
                against. A high score here says more about the absence of history than about the sign-in.
              </p>
            )}
            {anomaly.decision.modelAvailable === false && (
              <p className="detail-caveat">
                The risk engine was unreachable, so this score is the conservative fallback the
                service applies rather than anything the model produced.
              </p>
            )}
            {anomaly.decision.governedBy !== 'model' && (
              <p className="detail-caveat">
                A deterministic rule governed this decision, so the score was not what decided the
                outcome. Changing the model thresholds would not change this result.
              </p>
            )}
          </section>

          <section className="detail-block">
            <h3 className="detail-block__title">
              Signals outside their normal range
              {contributed.length ? ` (${contributed.length})` : ''}
            </h3>

            {contributed.length === 0 ? (
              <p className="secondary small">
                No individual signal was outside its normal range. The score came from the
                combination of values rather than from any one of them standing out.
              </p>
            ) : (
              <ul className="signals">
                {contributed.map((signal) => (
                  <li key={signal.feature} className="signal signal--flagged">
                    <div className="signal__head">
                      <span className="signal__label">{signal.label}</span>
                      <span className="signal__value">{signal.observed}</span>
                    </div>
                    <p className="signal__why">{signal.explanation}</p>
                  </li>
                ))}
              </ul>
            )}

            {normal.length > 0 && (
              <details className="detail-more">
                <summary>Signals that looked normal ({normal.length})</summary>
                <ul className="signals">
                  {normal.map((signal) => (
                    <li key={signal.feature} className="signal">
                      <div className="signal__head">
                        <span className="signal__label">{signal.label}</span>
                        <span className="signal__value">{signal.observed}</span>
                      </div>
                      <p className="signal__why">{signal.explanation}</p>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <p className="detail-note">
              These are the model's <em>inputs</em>, flagged against the cutoffs derived from the
              training data. They are not a breakdown of the score: an Isolation Forest score cannot
              be attributed to individual features, so "outside its normal range" does not mean
              "this is what caused the score".
              {thresholds && ` For reference, sign-ins above ${thresholds.allowMax} get a step-up challenge and those above ${thresholds.stepUpMax} are blocked.`}
            </p>
          </section>

          <ReviewVerdict anomaly={anomaly} onReviewed={onReviewed} />

          <section className="detail-block">
            <h3 className="detail-block__title">Where it came from</h3>
            <dl className="facts">
              <div className="facts__item">
                <dt className="facts__label">Location</dt>
                <dd className="facts__value">
                  {[anomaly.origin.city, anomaly.origin.country].filter(Boolean).join(', ') || 'Could not be resolved'}
                </dd>
              </div>
              <div className="facts__item">
                <dt className="facts__label">Address</dt>
                <dd className="facts__value mono">{anomaly.origin.ip || '—'}</dd>
              </div>
              <div className="facts__item">
                <dt className="facts__label">Device</dt>
                <dd className="facts__value">
                  {anomaly.origin.knownDevice ? 'Known to this account' : 'Not seen before'}
                </dd>
              </div>
              <div className="facts__item">
                <dt className="facts__label">Sign-in completed</dt>
                <dd className="facts__value">
                  {anomaly.decision.loginSucceeded ? 'Yes' : 'No'}
                </dd>
              </div>
            </dl>
          </section>

          {anomaly.account && (
            <section className="detail-block">
              <h3 className="detail-block__title">This account's recent sign-ins</h3>
              <p className="detail-note" style={{ marginTop: 0, marginBottom: 'var(--s3)' }}>
                The baseline the model was comparing against. "Unfamiliar country" means something
                different for an account that signs in from one city every day than for one that moves.
              </p>

              <Panel
                loading={history.loading}
                error={history.error}
                onRetry={history.reload}
                isEmpty={!history.data?.events?.length}
                loadingRows={3}
                empty={(
                  <p className="secondary small">
                    No successful sign-ins recorded for this account in the last 30 days, which is
                    itself why the model had little to go on.
                  </p>
                )}
              >
                <ul className="history">
                  {(history.data?.events || []).map((event) => (
                    <li key={event.id} className="history__item">
                      <time className="history__time small" dateTime={event.time}>
                        {new Date(event.time).toLocaleString()}
                      </time>
                      <span className="history__detail small secondary">{event.explanation}</span>
                      <span className="history__ip mono small muted">{event.ip || ''}</span>
                    </li>
                  ))}
                </ul>
              </Panel>

              <div className="row" style={{ marginTop: 'var(--s4)' }}>
                <Link
                  className="btn btn--outline btn--sm"
                  to={`/events?userId=${anomaly.account.id}`}
                  onClick={onClose}
                >
                  All events for this account
                </Link>
                <Link
                  className="btn btn--outline btn--sm"
                  to={`/users?userId=${anomaly.account.id}`}
                  onClick={onClose}
                >
                  Account detail
                </Link>
                <span className="push"><RoleBadge role={anomaly.account.role} /></span>
              </div>
            </section>
          )}

          <details className="detail-more">
            <summary>The exact values sent to the model</summary>
            <pre className="detail-raw">{JSON.stringify(anomaly.features, null, 2)}</pre>
            <p className="detail-note">
              Shown last and collapsed on purpose. It is here so a decision can be audited
              precisely, not because it is the useful view.
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}

/*
 * Was the service right?
 *
 * ── Why this is worth an administrator's time ──
 *
 * The model's published precision comes from the training set — how it did on
 * data it was tuned against. It says nothing about how it performs on this
 * deployment's real users at these thresholds. The administrator who just
 * phoned the account holder back is the only source of that answer, and
 * recording it is what gives the next retrain labelled production data instead
 * of more synthetic injections.
 *
 * So the question is asked in those terms — "was the service right" — rather
 * than as the model-validation vocabulary of true and false positives, which
 * means nothing to someone who has not read the training script. The stored
 * value is still the vocabulary a retrain needs.
 *
 * ── No verdict is its own state ──
 *
 * An unreviewed flag and a flag reviewed as fine are different facts, and the
 * panel shows the difference. Collapsing them would make a queue nobody has
 * looked at indistinguishable from an all-clear one.
 *
 * A recorded verdict can be changed. The row holds the current one; the trail
 * keeps every version, because it is append-only — so a correction is visible
 * as a correction rather than replacing the history.
 */
function ReviewVerdict({ anomaly, onReviewed }) {
  const [review, setReview] = useState(anomaly.review || null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const record = async (reviewStatus) => {
    setBusy(reviewStatus);
    setError(null);
    try {
      const result = await anomaliesApi.review(anomaly.id, { reviewStatus, note: note.trim() });
      setReview({
        status: result.anomaly.reviewStatus,
        note: result.anomaly.reviewNote,
        at: result.anomaly.reviewedAt,
        by: null,
      });
      setNote('');
      onReviewed?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the review.');
    } finally {
      setBusy(null);
    }
  };

  const LABEL = {
    true_positive: 'correctly flagged',
    false_positive: 'wrongly flagged',
    under_review: 'still under review',
  };

  return (
    <section className="detail-block">
      <h3 className="detail-block__title">Was the service right?</h3>

      <div className="verdict">
        {review && (
          <p className="verdict__recorded">
            Recorded as <strong>{LABEL[review.status]}</strong>
            {review.at ? ` on ${new Date(review.at).toLocaleString()}` : ''}
            {review.by?.fullName ? ` by ${review.by.fullName}` : ''}.
            {review.note && <span className="verdict__note"> “{review.note}”</span>}
            <br />
            <span className="small muted">
              You can change this; the audit log keeps both versions.
            </span>
          </p>
        )}

        <label className="field">
          <span className="field__label">
            What you found {review ? '(for a revised verdict)' : '(optional)'}
          </span>
          <textarea
            className="input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Phoned the owner; they were travelling for work."
            maxLength={500}
            disabled={Boolean(busy)}
          />
        </label>

        <div className="verdict__choices">
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => record('true_positive')}
            disabled={Boolean(busy)}
          >
            {busy === 'true_positive' ? 'Recording…' : 'Yes — correctly flagged'}
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => record('false_positive')}
            disabled={Boolean(busy)}
          >
            {busy === 'false_positive' ? 'Recording…' : 'No — this was a false alarm'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => record('under_review')}
            disabled={Boolean(busy)}
          >
            {busy === 'under_review' ? 'Recording…' : 'Still checking'}
          </button>
        </div>

        {error && <p className="confirm__error" role="alert">{error}</p>}

        <p className="detail-note" style={{ marginTop: 0 }}>
          This answer is kept as labelled data for the next time the model is retrained. The
          figures the model publishes come from its training set; yours come from this
          deployment's actual users at these thresholds, which is the only way the false-alarm
          rate gets better rather than merely measured.
        </p>
      </div>
    </section>
  );
}
