const redis = require('../config/redis');

/*
 * Live security events, for the dashboard to show without being refreshed.
 *
 * ── Why Redis pub/sub and not an EventEmitter ──
 *
 * An in-process emitter is simpler and would work perfectly for one instance.
 * It would also mean that the moment the service runs behind a load balancer
 * with two workers, an administrator connected to worker A stops seeing events
 * detected by worker B — silently, with no error anywhere, and in a way that is
 * invisible in development where there is only ever one process. A dashboard
 * that is sometimes live and sometimes not is worse than one that is honestly
 * polling, so the fan-out goes through Redis, which this service already runs.
 *
 * ── One subscriber, many clients ──
 *
 * Redis connections in subscriber mode cannot issue ordinary commands, so the
 * shared client cannot be used. One duplicate connection is created for the
 * process when the first dashboard connects and closed when the last one goes;
 * each connected administrator is a callback in a set, not a connection of
 * their own.
 *
 * ── Failure is quiet by design ──
 *
 * Publishing is fire-and-forget and never throws into the caller: it is reached
 * from the audit write, which is itself required never to turn a working
 * request into an error. If Redis is down, no events are delivered and the
 * dashboard's polling fallback takes over — which is the behaviour it would
 * have had anyway before any of this existed.
 */

const CHANNEL = 'security:events';

/** Connected dashboards: each entry is a function taking one event. */
const listeners = new Set();

let subscriber = null;
let subscribing = null;

/**
 * Announce an event to every connected dashboard.
 *
 * Takes the already-written row's essentials rather than a database id: the
 * dashboard uses this to raise a notification and mark its feed stale, and
 * making it re-read the row it was just told about would turn every event in
 * the service into a query per connected administrator.
 */
function publish(event) {
  if (!event || !event.eventType) return;
  try {
    const result = redis.publish(CHANNEL, JSON.stringify({
      ...event,
      at: event.at || new Date().toISOString(),
    }));
    // ioredis returns a promise; an unhandled rejection here would be an
    // unhandled rejection in whatever request happened to trigger the event.
    if (result && typeof result.catch === 'function') {
      result.catch((err) => console.error('Security stream publish failed:', err.message));
    }
  } catch (err) {
    console.error('Security stream publish failed:', err.message);
  }
}

function fanOut(raw) {
  let event;
  try { event = JSON.parse(raw); } catch { return; }
  for (const listener of listeners) {
    try { listener(event); } catch (err) {
      console.error('Security stream listener failed:', err.message);
    }
  }
}

async function openSubscriber() {
  if (subscriber) return subscriber;
  if (subscribing) return subscribing;

  subscribing = (async () => {
    /*
     * The shared client is configured to fail fast — enableOfflineQueue false,
     * one retry — which is right for the request path, where a Redis command
     * that cannot be served immediately should give up so the caller can fall
     * back to PostgreSQL. It is wrong for a subscriber: a brand-new connection
     * is not writable for the few milliseconds it takes to open, so subscribing
     * on it is refused outright with "Stream isn't writeable".
     *
     * So the duplicate overrides that. A subscriber has no latency budget to
     * protect and nothing to fall back to; what it needs is to wait for its
     * socket. Readiness is then awaited explicitly, so `live` reports whether
     * events will actually arrive rather than whether a connection object was
     * constructed.
     */
    const connection = redis.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
    connection.on('error', (err) => console.error('Security stream subscriber error:', err.message));
    connection.on('message', (channel, raw) => { if (channel === CHANNEL) fanOut(raw); });

    await new Promise((resolve, reject) => {
      if (connection.status === 'ready') return resolve();
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Redis did not become ready in time'));
      }, 3000);
      function cleanup() {
        clearTimeout(timer);
        connection.off('ready', onReady);
        connection.off('error', onError);
      }
      function onReady() { cleanup(); resolve(); }
      function onError(err) { cleanup(); reject(err); }
      connection.once('ready', onReady);
      connection.once('error', onError);
      return undefined;
    }).catch((err) => {
      try { connection.disconnect(); } catch { /* nothing to close */ }
      throw err;
    });

    await connection.subscribe(CHANNEL);
    subscriber = connection;
    return connection;
  })();

  try {
    return await subscribing;
  } finally {
    subscribing = null;
  }
}

function closeSubscriberIfIdle() {
  if (listeners.size > 0 || !subscriber) return;
  const connection = subscriber;
  subscriber = null;
  try { connection.disconnect(); } catch { /* already gone */ }
}

/**
 * Register a dashboard. Returns an unsubscribe function.
 *
 * Resolves to whether live delivery is actually available, so the endpoint can
 * tell the client to fall back to polling instead of leaving it waiting on a
 * stream that will never produce anything.
 */
async function subscribe(listener) {
  listeners.add(listener);
  try {
    await openSubscriber();
    return { live: true, unsubscribe: () => { listeners.delete(listener); closeSubscriberIfIdle(); } };
  } catch (err) {
    console.error('Security stream unavailable, clients should poll:', err.message);
    listeners.delete(listener);
    return { live: false, unsubscribe: () => {} };
  }
}

/** For shutdown and for tests, which must not leave a connection open. */
function shutdown() {
  listeners.clear();
  closeSubscriberIfIdle();
}

module.exports = { publish, subscribe, shutdown, CHANNEL, listenerCount: () => listeners.size };
