import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fixtures, renderPage, stubFetch, streamStub } from './harness';

/*
 * The visualisation module, rendered.
 *
 * These tests answer the questions the build cannot: does each view mount
 * inside its providers, does it put the service's numbers on screen unchanged,
 * and does the shared filter state actually reach the requests. A chart that
 * compiles and then throws on its first render is the failure mode a bundler
 * never catches.
 */

beforeEach(() => {
  stubFetch([streamStub().route]);
  // Give the API client a session: every panel's request carries a bearer
  // token, and without one the client would short-circuit before fetching.
  return import('../api/client').then(({ setTokens }) =>
    setTokens({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token-0123456789abcdef0123456789abcdef' }));
});

describe('Overview', () => {
  it('shows the service figures, not rounded or recomputed ones', async () => {
    const OverviewPage = (await import('../pages/OverviewPage')).default;
    await renderPage(<OverviewPage />);

    await waitFor(() => expect(screen.getByText('Successful sign-ins')).toBeInTheDocument());

    // 12 sign-ins, 3 failed, 4 flagged — exactly the fixture's values.
    const logins = screen.getByText('Successful sign-ins').closest('.tile');
    expect(within(logins).getByText('12')).toBeInTheDocument();

    const failed = screen.getByText('Failed attempts').closest('.tile');
    expect(within(failed).getByText('3')).toBeInTheDocument();

    const active = screen.getByText('Signed in now').closest('.tile');
    expect(within(active).getByText('4')).toBeInTheDocument();
  });

  it('describes a trend in words, not only as a colour', async () => {
    const OverviewPage = (await import('../pages/OverviewPage')).default;
    await renderPage(<OverviewPage />);

    await waitFor(() => expect(screen.getByText('Failed attempts')).toBeInTheDocument());

    // Failed attempts fell from 9 to 3: the direction has to be readable.
    const failed = screen.getByText('Failed attempts').closest('.tile');
    expect(within(failed).getByText(/66\.7% fewer than the previous period/)).toBeInTheDocument();
  });

  it('reports growth from zero as "none previously" rather than +100%', async () => {
    const OverviewPage = (await import('../pages/OverviewPage')).default;
    await renderPage(<OverviewPage />);

    await waitFor(() => expect(screen.getByText('Anomalies flagged')).toBeInTheDocument());

    // The fixture has anomaliesFlagged going 0 -> 4, trend null.
    const flagged = screen.getByText('Anomalies flagged').closest('.tile');
    expect(within(flagged).getByText('none previously')).toBeInTheDocument();
    expect(within(flagged).queryByText(/100%/)).not.toBeInTheDocument();
  });

  it('renders the timeline with a legend naming every band', async () => {
    const OverviewPage = (await import('../pages/OverviewPage')).default;
    await renderPage(<OverviewPage />);

    await waitFor(() => expect(screen.getByText('Events over time')).toBeInTheDocument());

    // Scoped to the legend: the band names deliberately appear again as the
    // figures table's column headers, which is the point of that table.
    const legend = document.querySelector('.legend');
    expect(legend).not.toBeNull();
    // Identity is never carried by colour alone: each series is named.
    expect(within(legend).getByText('Login success')).toBeInTheDocument();
    expect(within(legend).getByText('Login blocked')).toBeInTheDocument();
    expect(within(legend).getByText('Resource access')).toBeInTheDocument();
  });

  it('offers the same figures as a table', async () => {
    const OverviewPage = (await import('../pages/OverviewPage')).default;
    await renderPage(<OverviewPage />);

    await waitFor(() => expect(screen.getByText('Events over time')).toBeInTheDocument());

    // The obligation that comes with three light-mode slots below 3:1 contrast.
    await userEvent.click(screen.getByRole('button', { name: /show figures/i }));
    expect(screen.getByText('Event counts per bucket')).toBeInTheDocument();
  });
});

describe('Events', () => {
  it('lists events with their severity and explanation', async () => {
    const EventsPage = (await import('../pages/EventsPage')).default;
    await renderPage(<EventsPage />, { path: '/events' });

    await waitFor(() => expect(screen.getByText('All events')).toBeInTheDocument());

    const row = screen.getByText(/Sign-in blocked and the account frozen/).closest('tr');
    expect(within(row).getByText('Critical')).toBeInTheDocument();
    expect(within(row).getByText('Grace Wanjiku')).toBeInTheDocument();
    expect(within(row).getByText('login blocked')).toBeInTheDocument();
  });

  it('sends the filters from the URL to the service', async () => {
    const EventsPage = (await import('../pages/EventsPage')).default;
    const stub = stubFetch([streamStub().route]);
    await renderPage(<EventsPage />, { path: '/events?window=7d&severity=critical&role=family' });

    await waitFor(() => expect(screen.getByText('All events')).toBeInTheDocument());

    const called = stub.mock.calls.map(([url]) => String(url));
    const eventsCall = called.find((u) => u.includes('/admin/events?'));
    expect(eventsCall).toContain('window=7d');
    expect(eventsCall).toContain('severity=critical');
    expect(eventsCall).toContain('role=family');
  });

  it('asks the chart and the table for the same window', async () => {
    const EventsPage = (await import('../pages/EventsPage')).default;
    const stub = stubFetch([streamStub().route]);
    await renderPage(<EventsPage />, { path: '/events?window=7d' });

    await waitFor(() => expect(screen.getByText('All events')).toBeInTheDocument());

    const called = stub.mock.calls.map(([url]) => String(url));
    // The acceptance criterion: the views agree about the period.
    expect(called.find((u) => u.includes('timeseries'))).toContain('window=7d');
    expect(called.find((u) => u.includes('/admin/events?'))).toContain('window=7d');
  });

  it('never renders an explanation as markup', async () => {
    const EventsPage = (await import('../pages/EventsPage')).default;
    stubFetch([
      streamStub().route,
      [/\/admin\/events/, () => ({
        ...fixtures.events,
        events: [{
          ...fixtures.events.events[0],
          explanation: 'Blocked <img src=x onerror="alert(1)"> from device',
        }],
      })],
    ]);
    const { container } = await renderPage(<EventsPage />, { path: '/events' });

    await waitFor(() => expect(screen.getByText('All events')).toBeInTheDocument());

    // Attacker-influenced strings reach this column. React escapes by default;
    // this asserts nobody has reintroduced dangerouslySetInnerHTML.
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/Blocked <img src=x onerror="alert\(1\)"> from device/)).toBeInTheDocument();
  });
});

describe('Anomalies', () => {
  it('marks the decision thresholds on the distribution', async () => {
    const AnomaliesPage = (await import('../pages/AnomaliesPage')).default;
    await renderPage(<AnomaliesPage />, { path: '/anomalies' });

    await waitFor(() => expect(screen.getByText('Risk score distribution')).toBeInTheDocument());

    /*
     * Asserted on the footnote, not on the SVG reference-line labels: Recharts
     * positions those from measured layout, which jsdom does not do, so they
     * never render here. The footnote is the better assertion regardless — it
     * is the statement of the thresholds that a screen reader gets and that
     * survives the chart being unreadable for any other reason.
     */
    expect(screen.getByText(/Sign-ins scoring up to 58\.9 are allowed/)).toBeInTheDocument();
    expect(screen.getByText(/up to 88 get a step-up challenge/)).toBeInTheDocument();
  });

  it('breaks the period down by layer and by role', async () => {
    const AnomaliesPage = (await import('../pages/AnomaliesPage')).default;
    await renderPage(<AnomaliesPage />, { path: '/anomalies' });

    await waitFor(() => expect(
      screen.getByRole('heading', { name: 'Where the concerns came from' })).toBeInTheDocument());

    // The layer labels, in the bars rather than in the figures table.
    const layers = screen.getByRole('heading', { name: 'Where the concerns came from' })
      .closest('.chart').querySelector('.breakdown');
    expect(within(layers).getByText('Sign-in')).toBeInTheDocument();
    expect(within(layers).getByText('Resource access')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'By account type' })).toBeInTheDocument();
  });

  it('explains a flagged sign-in in plain language, with its signals', async () => {
    const AnomaliesPage = (await import('../pages/AnomaliesPage')).default;
    await renderPage(<AnomaliesPage />, { path: '/anomalies' });

    await waitFor(() => expect(screen.getByText('Review queue')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /examine/i }));

    const dialog = await screen.findByRole('dialog');

    // The service's own sentence is the headline.
    expect(within(dialog).getByText(/Flagged as high risk due to/)).toBeInTheDocument();

    // Each contributing signal names the value observed and why it matters.
    expect(within(dialog).getByText('not seen on this account before')).toBeInTheDocument();
    expect(within(dialog).getByText(/6 sign-in attempts in the preceding window/)).toBeInTheDocument();
    expect(within(dialog).getByText(/pattern of someone working through codes/)).toBeInTheDocument();
  });

  it('states that the signals are not an attribution of the score', async () => {
    const AnomaliesPage = (await import('../pages/AnomaliesPage')).default;
    await renderPage(<AnomaliesPage />, { path: '/anomalies' });

    await waitFor(() => expect(screen.getByText('Review queue')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /examine/i }));

    const dialog = await screen.findByRole('dialog');
    // The honesty requirement: an Isolation Forest score cannot be decomposed,
    // and the screen must not imply otherwise.
    expect(within(dialog).getByText(/cannot be attributed to individual features/)).toBeInTheDocument();
  });

  it('closes the detail dialog on Escape', async () => {
    const AnomaliesPage = (await import('../pages/AnomaliesPage')).default;
    await renderPage(<AnomaliesPage />, { path: '/anomalies' });

    await waitFor(() => expect(screen.getByText('Review queue')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /examine/i }));
    await screen.findByRole('dialog');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('Locations', () => {
  it('lists the impossible-travel pair with its distance and elapsed time', async () => {
    const MapPage = (await import('../pages/MapPage')).default;
    await renderPage(<MapPage />, { path: '/map' });

    await waitFor(() => expect(screen.getByText('Sign-in locations')).toBeInTheDocument());

    // A red line on a map is not an explanation; the figures carry it.
    expect(screen.getByText('Impossible travel in this period')).toBeInTheDocument();
    expect(screen.getByText('3828 km')).toBeInTheDocument();
    expect(screen.getByText('42 min')).toBeInTheDocument();
    expect(screen.getByText('5469 km/h')).toBeInTheDocument();
  });

  it('says what the coordinates actually mean', async () => {
    const MapPage = (await import('../pages/MapPage')).default;
    await renderPage(<MapPage />, { path: '/map' });

    await waitFor(() => expect(screen.getByText('Sign-in locations')).toBeInTheDocument());
    expect(screen.getByText(/where a network provider appears to be/)).toBeInTheDocument();
  });
});

describe('Error and empty states', () => {
  it('distinguishes an unreachable service from an empty result', async () => {
    const EventsPage = (await import('../pages/EventsPage')).default;
    stubFetch([
      streamStub().route,
      [/\/admin\/events/, () => { throw new TypeError('network down'); }],
    ]);
    await renderPage(<EventsPage />, { path: '/events' });

    await waitFor(() =>
      expect(screen.getByText('The authentication service did not answer')).toBeInTheDocument());
    expect(screen.getByText(/Nothing has changed on the server/)).toBeInTheDocument();
  });

  it('does not offer a retry for a refusal', async () => {
    const EventsPage = (await import('../pages/EventsPage')).default;
    stubFetch([
      streamStub().route,
      [/\/admin\/events/, () => ({
        status: 403,
        body: { error: 'You do not have permission to perform this action' },
      })],
    ]);
    await renderPage(<EventsPage />, { path: '/events' });

    await waitFor(() => expect(screen.getByText('Not permitted')).toBeInTheDocument());
    // Retrying a 403 just hammers an endpoint that will keep saying no.
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('says an empty result is probably good news, and offers to widen', async () => {
    const EventsPage = (await import('../pages/EventsPage')).default;
    stubFetch([
      streamStub().route,
      [/\/admin\/events/, () => ({ ...fixtures.events, total: 0, events: [] })],
    ]);
    await renderPage(<EventsPage />, { path: '/events?severity=critical' });

    await waitFor(() => expect(screen.getByText('No events match')).toBeInTheDocument());
    expect(screen.getByText(/usually good news/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });
});
