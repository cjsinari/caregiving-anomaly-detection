import { useNavigate } from 'react-router-dom';
import FilterBar from '../dashboard/FilterBar';
import EventsTable from '../dashboard/EventsTable';
import EventsTimeline from '../charts/EventsTimeline';
import { Panel } from '../components/States';
import { events as eventsApi } from '../api/endpoints';
import { useFilters } from '../dashboard/FilterContext';
import { useLive } from '../dashboard/LiveContext';
import { useInterval, useResource } from '../dashboard/useResource';

/*
 * The full event feed, with the shape of the period above it.
 *
 * The chart and the table read the same filters and the same window, so the
 * bands above and the rows below are always the same set of events seen two
 * ways. That is the point of keeping the filter state in one place rather than
 * per panel: a chart that disagreed with the table under it would make both
 * useless, and there would be no way to tell which one was wrong.
 */
export default function EventsPage() {
  const { queryFor, setFilters } = useFilters();
  const { revision, isLive } = useLive();
  const navigate = useNavigate();

  const timelineQuery = queryFor({ groupBy: 'eventType' });
  const timeline = useResource(
    ({ signal }) => eventsApi.timeseries(timelineQuery, { signal }),
    [JSON.stringify(timelineQuery), revision]
  );

  useInterval(() => timeline.reload(), 60_000, { enabled: !isLive });

  const drillDown = (point) => {
    const width = (timeline.data?.bucketSeconds || 3600) * 1000;
    const from = new Date(point.at * 1000).toISOString();
    const to = new Date(point.at * 1000 + width).toISOString();
    setFilters({ window: '', from, to }, { replace: false });
  };

  return (
    <>
      <FilterBar show={['window', 'severity', 'role', 'search']} />

      <div className="stack">
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

        <EventsTable
          title="All events"
          subtitle="Newest first unless re-sorted"
        />
      </div>
    </>
  );
}
