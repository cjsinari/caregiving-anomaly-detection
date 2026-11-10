import { Link, useNavigate } from 'react-router-dom';
import FilterBar from '../dashboard/FilterBar';
import StatTile from '../dashboard/StatTile';
import EventsTimeline from '../charts/EventsTimeline';
import { Panel } from '../components/States';
import { SeverityBadge } from '../components/Badge';
import { events as eventsApi, stats as statsApi } from '../api/endpoints';
import { useFilters } from '../dashboard/FilterContext';
import { useLive } from '../dashboard/LiveContext';
import { useInterval, useResource } from '../dashboard/useResource';

/*
 * The first screen: what has happened, and what needs attention now.
 *
 * ── Which numbers, and in what order ──
 *
 * The first row is the four an administrator came to check: are people getting
 * in, is anything failing to get in, is the model flagging things, is anyone
 * locked out. The second row is context for the first. Everything is a count of
 * rows the detection layers wrote, with no derived or smoothed figures, so any
 * tile can be checked against the database by hand — which is the acceptance
 * criterion for this view, and the only way a dashboard earns trust.
 *
 * ── Refreshing ──
 *
 * When the live stream is up, the panels reload because an event arrived, not
 * on a timer. The timer is the fallback for when it is not, and it pauses while
 * the tab is hidden: the service flags a session that makes too many requests,
 * so a console left open overnight on a background tab must not quietly trip
 * the detector it exists to display.
 */
export default function OverviewPage() {
  const { filters, queryFor, setFilters } = useFilters();
  const { revision, isLive } = useLive();
  const navigate = useNavigate();

  const summaryQuery = { window: filters.window };
  const summary = useResource(
    ({ signal }) => statsApi.summary(summaryQuery, { signal }),
    [JSON.stringify(summaryQuery), revision]
  );

  const timelineQuery = queryFor({ groupBy: 'eventType' });
  const timeline = useResource(
    ({ signal }) => eventsApi.timeseries(timelineQuery, { signal }),
    [JSON.stringify(timelineQuery), revision]
  );

  const recentQuery = queryFor({ limit: 8, severity: filters.severity || undefined });
  const recent = useResource(
    ({ signal }) => eventsApi.list({ ...recentQuery, sort: 'severity' }, { signal }),
    [JSON.stringify(recentQuery), revision]
  );

  // Only when the stream is not delivering. Reloading on a timer as well would
  // double the request rate for no extra information.
  useInterval(() => {
    summary.reload();
    timeline.reload();
    recent.reload();
  }, 60_000, { enabled: !isLive });

  const m = summary.data?.metrics;

  /** A point on the timeline narrows every view to that bucket. */
  const drillDown = (point) => {
    const width = (timeline.data?.bucketSeconds || 3600) * 1000;
    const from = new Date(point.at * 1000);
    const to = new Date(point.at * 1000 + width);
    setFilters({ window: '', from: from.toISOString(), to: to.toISOString() }, { replace: false });
    navigate(`/events?from=${from.toISOString()}&to=${to.toISOString()}`);
  };

  return (
    <>
      <FilterBar show={['window', 'severity', 'role', 'search']} />

      <div className="stack">
        <Panel
          loading={summary.loading}
          error={summary.error}
          onRetry={summary.reload}
          loadingLabel="Loading the security summary…"
        >
          <div className="tile-grid">
            <StatTile
              label="Successful sign-ins"
              value={m?.logins.value}
              previous={m?.logins.previous}
              trend={m?.logins.trend}
              polarity="neutral"
              href="/events?eventType=login_success"
            />
            <StatTile
              label="Failed attempts"
              value={m?.failedLogins.value}
              previous={m?.failedLogins.previous}
              trend={m?.failedLogins.trend}
              polarity="upBad"
              hint="Wrong or expired codes"
              href="/events?eventType=otp_failed"
            />
            <StatTile
              label="Anomalies flagged"
              value={m?.anomaliesFlagged.value}
              previous={m?.anomaliesFlagged.previous}
              trend={m?.anomaliesFlagged.trend}
              polarity="upBad"
              hint="Step-up or blocked"
              href="/anomalies"
              emphasis
            />
            <StatTile
              label="Sessions ended by a detector"
              value={m?.sessionsBlocked.value}
              previous={m?.sessionsBlocked.previous}
              trend={m?.sessionsBlocked.trend}
              polarity="upBad"
              href="/sessions?status=flagged"
            />
            <StatTile
              label="Signed in now"
              value={summary.data?.activeSessions}
              trend={null}
              previous={0}
              hint="Not a windowed count"
              href="/sessions"
            />
          </div>

          <div className="tile-grid" style={{ marginTop: 'var(--s4)' }}>
            <StatTile
              label="Sign-ins blocked"
              value={m?.loginsBlocked.value}
              previous={m?.loginsBlocked.previous}
              trend={m?.loginsBlocked.trend}
              polarity="upBad"
              href="/anomalies?action=block"
            />
            <StatTile
              label="Step-up challenges"
              value={m?.stepUpsRequired.value}
              previous={m?.stepUpsRequired.previous}
              trend={m?.stepUpsRequired.trend}
              polarity="neutral"
              hint="Extra verification asked for"
            />
            <StatTile
              label="Access refused"
              value={m?.accessDenied.value}
              previous={m?.accessDenied.previous}
              trend={m?.accessDenied.trend}
              polarity="upBad"
              hint="Care records, by the ownership rules"
              href="/events?decision=deny"
            />
            <StatTile
              label="High and critical events"
              value={m?.urgentEvents.value}
              previous={m?.urgentEvents.previous}
              trend={m?.urgentEvents.trend}
              polarity="upBad"
              href="/events?severity=critical"
            />
            <StatTile
              label="Average risk score"
              value={summary.data?.averageRiskScore?.value}
              previous={summary.data?.averageRiskScore?.previous ?? 0}
              trend={null}
              hint="Across scored sign-ins"
            />
          </div>
        </Panel>

        <Panel
          loading={timeline.loading}
          error={timeline.error}
          onRetry={timeline.reload}
          loadingLabel="Loading the event timeline…"
        >
          <EventsTimeline
            data={timeline.data}
            bucketLabel={timeline.data?.bucketLabel}
            onDrillDown={drillDown}
          />
        </Panel>

        <section className="card">
          <header className="card__header">
            <div>
              <h2 className="card__title">Needs attention first</h2>
              <p className="card__subtitle">
                The most severe events in this period, most serious first
              </p>
            </div>
            {/* A Link, not an anchor: a full document load would discard the
                in-memory access token and bounce back to the login screen. */}
            <Link className="btn btn--outline btn--sm" to="/events">See all events</Link>
          </header>

          <Panel
            loading={recent.loading}
            error={recent.error}
            onRetry={recent.reload}
            isEmpty={!recent.data?.events?.length}
            loadingRows={5}
            empty={(
              <div className="state">
                <p className="state__title">Nothing of concern</p>
                <p className="state__detail">
                  No events in this period. On a security dashboard that is the result you want.
                </p>
              </div>
            )}
          >
            <ul className="attention">
              {(recent.data?.events || []).map((event) => (
                <li key={event.id} className="attention__item">
                  <div className="attention__head">
                    <SeverityBadge severity={event.severity} />
                    <span className="attention__type">{String(event.eventType).replace(/_/g, ' ')}</span>
                    <time className="attention__time small muted" dateTime={event.time}>
                      {new Date(event.time).toLocaleString()}
                    </time>
                  </div>
                  {/* The sentence the service recorded when the event happened,
                      rendered as text. Never as markup: an explanation can
                      contain values that came from a request. */}
                  <p className="attention__why">{event.explanation}</p>
                  {event.actor && (
                    <p className="attention__who small muted">
                      {event.actor.fullName || 'Unknown account'}
                      {event.actor.role ? ` · ${event.actor.role}` : ''}
                      {event.ip ? ` · ${event.ip}` : ''}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </section>
      </div>
    </>
  );
}
