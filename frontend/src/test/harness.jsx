import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import * as fixtures from './fixtures';

/*
 * Mounting a view the way the application mounts it.
 *
 * The providers are not optional scaffolding — a page that reads the shared
 * filters crashes outside FilterProvider, and that is exactly the failure a
 * render test exists to catch. So the harness composes the same stack the real
 * layout does, and a test that passes here is evidence the page works where it
 * actually lives.
 *
 * The network is stubbed at `fetch` rather than by mocking the endpoint module.
 * Stubbing the module would skip the API client — the query-string building, the
 * error shaping, the 401 handling — which is a meaningful part of what each
 * panel depends on. Stubbing fetch exercises all of it and still never touches
 * a network.
 */

/** Route patterns to canned responses, matched in order. */
const DEFAULT_ROUTES = [
  [/\/auth\/me$/, () => fixtures.me],
  [/\/admin\/stats\/summary/, () => fixtures.summary],
  [/\/admin\/stats\/timeseries/, () => fixtures.timeseries],
  [/\/admin\/anomalies\/distribution/, () => fixtures.distribution],
  [/\/admin\/anomalies/, () => fixtures.anomalies],
  [/\/admin\/sessions/, () => fixtures.sessions],
  [/\/admin\/locations/, () => fixtures.locations],
  [/\/admin\/model/, () => fixtures.modelInfo],
  [/\/admin\/policy/, () => fixtures.policy],
  [/\/admin\/events\.csv/, () => 'csv'],
  [/\/admin\/events/, () => fixtures.events],
  [/\/audit\/accounts/, () => fixtures.accounts],
  [/\/audit/, () => fixtures.auditTrail],
];

/**
 * Install a fetch stub.
 *
 * `overrides` takes precedence, so a test can make one endpoint fail or return
 * something specific without restating the other twelve. Anything unmatched
 * rejects loudly: a silent 200 for an endpoint nobody stubbed is how a test
 * ends up asserting against an empty panel and passing.
 */
export function stubFetch(overrides = []) {
  const routes = [...overrides, ...DEFAULT_ROUTES];

  const stub = vi.fn(async (url, options = {}) => {
    const path = String(url);

    for (const [pattern, respond] of routes) {
      if (!pattern.test(path)) continue;

      const result = await respond({ url: path, options });
      if (result && typeof result === 'object' && 'status' in result && 'body' in result) {
        return jsonResponse(result.body, result.status, result.headers);
      }
      if (typeof result === 'string') {
        return new Response(result, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="events.csv"',
          },
        });
      }
      return jsonResponse(result, 200);
    }

    throw new Error(`No stub for ${path}`);
  });

  globalThis.fetch = stub;
  return stub;
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * The stream endpoint, which the live context opens on mount.
 *
 * Returns a body that sends `ready` with `live: false` and then stays open, so
 * the console settles into polling mode rather than retrying a failed
 * connection on a timer for the duration of every test.
 */
export const streamRoute = [/\/admin\/stream/, () => ({
  status: 200,
  body: null,
  headers: {},
})];

/** A stream stub that actually streams: push events into a mounted console. */
export function streamStub() {
  let controller;
  const route = [/\/admin\/stream/, () => {
    const stream = new ReadableStream({
      start(c) {
        controller = c;
        c.enqueue(new TextEncoder().encode(
          `event: ready\ndata: ${JSON.stringify({ live: true, fallback: null, heartbeatSeconds: 25 })}\n\n`
        ));
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }];

  return {
    route,
    /** Deliver an event to the console under test. */
    emit(event) {
      controller?.enqueue(new TextEncoder().encode(
        `event: security\ndata: ${JSON.stringify({ at: new Date().toISOString(), ...event })}\n\n`
      ));
    },
    close() { controller?.close(); },
  };
}

/**
 * Render one page inside the providers it needs.
 *
 * `path` sets the initial URL, which is how the shared filters are seeded —
 * they live in the query string, so a test for a filtered view sets the filter
 * by navigating to it, exactly as the application does.
 */
export async function renderPage(ui, { path = '/', route = '*' } = {}) {
  // Imported here, not at module scope: these pull in the API client, whose
  // token store is module state, and the harness must not bind to a copy
  // loaded before the test's own module registry was set up.
  const { FilterProvider } = await import('../dashboard/FilterContext');
  const { LiveProvider } = await import('../dashboard/LiveContext');

  return render(
    <MemoryRouter initialEntries={[path]}>
      <LiveProvider>
        <FilterProvider>
          <Routes>
            <Route path={route} element={ui} />
          </Routes>
        </FilterProvider>
      </LiveProvider>
    </MemoryRouter>
  );
}

export { fixtures };
