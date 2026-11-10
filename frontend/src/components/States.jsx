/*
 * Loading, empty and error, as three components used everywhere.
 *
 * Every panel in the dashboard has the same three non-success states, and the
 * distinction between them is the whole point: "nothing matched your filters",
 * "we could not reach the service" and "you are not allowed to see this" are
 * three different things for the person reading the screen, and collapsing them
 * into one grey box is how an administrator ends up refreshing a page that was
 * never going to load.
 */

/** A panel that is loading. `rows` draws table-shaped skeletons instead. */
export function LoadingState({ label = 'Loading…', rows = 0, inline = false }) {
  if (rows > 0) {
    return (
      <div style={{ padding: 'var(--s4)' }} aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}</span>
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="skeleton"
            style={{ marginBottom: 'var(--s3)', width: `${92 - (i % 4) * 11}%` }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`state${inline ? ' state--inline' : ''}`} aria-busy="true" aria-live="polite">
      <div className="spinner" />
      <p className="state__detail">{label}</p>
    </div>
  );
}

/**
 * Nothing to show — which on a security dashboard is often good news, so the
 * wording is not apologetic. `onClear` appears when the emptiness is the
 * filters' doing rather than the data's, which is the case worth acting on.
 */
export function EmptyState({ title = 'Nothing to show', detail, onClear, clearLabel = 'Clear filters' }) {
  return (
    <div className="state">
      <p className="state__title">{title}</p>
      {detail && <p className="state__detail">{detail}</p>}
      {onClear && (
        <button type="button" className="btn btn--outline btn--sm" onClick={onClear}>
          {clearLabel}
        </button>
      )}
    </div>
  );
}

/**
 * Something went wrong, said as precisely as the error allows.
 *
 * The three cases are separated because the right next action differs. A
 * refusal is not retryable and offering a retry button invites an administrator
 * to hammer an endpoint that will keep saying no; a network failure is
 * retryable and usually resolves on its own; a rate limit resolves after a
 * stated wait, so the wait is stated.
 */
export function ErrorState({ error, onRetry, inline = false }) {
  const code = error?.code;
  const status = error?.status;

  let title = 'Could not load this';
  let detail = error?.message || 'Something went wrong.';
  let retryable = Boolean(onRetry);

  if (code === 'NETWORK') {
    title = 'The authentication service did not answer';
    detail = 'It may be restarting, or this console may have lost its connection. Nothing has changed on the server.';
  } else if (status === 403) {
    title = 'Not permitted';
    detail = error.message || 'Your account is not allowed to see this.';
    retryable = false;
  } else if (status === 429 || code === 'API_VELOCITY_EXCEEDED') {
    title = 'Too many requests';
    const wait = error.retryAfterSeconds;
    detail = `This console has been asking too often.${wait ? ` Try again in ${wait} seconds.` : ' Try again shortly.'}`;
  } else if (status === 400) {
    title = 'The service rejected that request';
    detail = error.details?.length
      ? error.details.map((d) => `${d.field}: ${d.message}`).join('; ')
      : detail;
    retryable = false;
  }

  return (
    <div className={`state${inline ? ' state--inline' : ''}`} role="alert">
      <p className="state__title">{title}</p>
      <p className="state__detail">{detail}</p>
      {retryable && (
        <button type="button" className="btn btn--outline btn--sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * The three states and the content, chosen in one place.
 *
 * Panels differ in what they render, not in how they decide what to render, and
 * writing that decision out by hand in each one is how a panel ends up showing
 * an empty table while a request is still in flight.
 */
export function Panel({ loading, error, isEmpty, onRetry, empty, loadingRows, loadingLabel, children }) {
  if (loading) return <LoadingState rows={loadingRows} label={loadingLabel} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isEmpty) return empty || <EmptyState />;
  return children;
}
