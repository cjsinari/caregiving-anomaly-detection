import Constants from 'expo-constants';
import { api, ApiError } from './client';
import { mockCaregiverApi } from './mock/caregiverData';

/*
 * Every call the caregiver screens make, and the one decision about where the
 * answers come from.
 *
 * ── The problem this file solves ──
 *
 * Issue #44 asks for seven things. Two of them -- the list of people a
 * caregiver is assigned to, and the detail behind one of them -- already have
 * a service behind them: `auth-service` exposes GET /profiles, scoped at the
 * database to the caregiver's active assignments (resourceAccess.js). The
 * other five -- visits, tasks, check-in and check-out, care notes, incident
 * reports, emergency contacts -- have no endpoint at all. There is no care
 * module yet.
 *
 * Which leaves two bad options and one good one. Building the screens against
 * /profiles alone means a visit schedule with nothing in it and a check-in
 * button that does nothing, which is not a screen anyone can review. Building
 * half against the service and half against a fixture means a list where the
 * name is real and the visit count is invented, and no way to tell which is
 * which when something looks wrong.
 *
 * So the whole caregiver module reads from *one* source, chosen once per app
 * run, and `mockCaregiverApi` answers in exactly the shapes the care module
 * will answer in. When the module lands, this file is the only one that
 * changes: the screens below it never learn which source they were reading.
 *
 * ── How the source is chosen ──
 *
 *   app.json → expo.extra.careApi
 *     'auto'  (default) probe the service once; fall back to the mock if the
 *             care module is not mounted.
 *     'mock'  never call the service. What a demo or a laptop with no
 *             database runs on.
 *     'live'  never fall back. What CI runs on once the module exists, so a
 *             broken endpoint fails loudly instead of being papered over by a
 *             fixture that always works.
 *
 * The probe is one request and its result is remembered, so this costs a
 * single 404 on the first screen and nothing afterwards.
 */

const CONFIGURED_MODE = String(Constants.expoConfig?.extra?.careApi || 'auto').toLowerCase();

/** The mode in force. Only a test ever changes it; see __resetCareApiForTests. */
let mode = CONFIGURED_MODE;

const startingSource = () => (mode === 'mock' ? 'mock' : mode === 'live' ? 'live' : null);

/** Resolved on the first call: 'live' or 'mock'. */
let resolvedSource = startingSource();
let probeInFlight = null;

/** What the app is actually reading. Rendered in the README's troubleshooting table. */
export function careApiSource() {
  return resolvedSource || 'unresolved';
}

/**
 * Test seam: put the module back to a known mode.
 *
 * It sets the *mode*, not just the resolved source, because the two are not
 * the same decision -- 'live' has to disable the per-route fallback as well as
 * the probe, and a seam that set only the source would leave a pinned-live app
 * quietly answering a 404 with fixture data.
 */
export function __resetCareApiForTests(override) {
  mode = override || CONFIGURED_MODE;
  resolvedSource = startingSource();
  probeInFlight = null;
}

/*
 * Does the service have a care module?
 *
 * A 404 or a 501 is the answer "not mounted", and is the whole point of the
 * probe. Anything else -- a 500, a timeout, a dead network -- is *not*: the
 * module may well be there and simply having a bad minute, and silently
 * swapping a caregiver onto fixture data at that moment would show them three
 * invented patients and a visit schedule that is not theirs. That is a worse
 * failure than an error message, so it stays live and the error surfaces.
 */
async function probe() {
  try {
    await api.authed.get('/care/health');
    return 'live';
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      if (__DEV__) {
        console.info(
          '[care] No care module on the service (404). Falling back to the mock dataset. '
          + "Set expo.extra.careApi to 'live' in app.json to turn this off."
        );
      }
      return 'mock';
    }
    throw err;
  }
}

async function source() {
  if (resolvedSource) return resolvedSource;
  if (!probeInFlight) {
    probeInFlight = probe()
      .then((value) => { resolvedSource = value; return value; })
      .finally(() => { probeInFlight = null; });
  }
  return probeInFlight;
}

/**
 * Run `live` or `mock`, whichever this app run is using.
 *
 * In 'auto' a live call that comes back 404 flips the source permanently and
 * retries against the mock, which covers the case where /care/health exists
 * but an individual route has not been written yet.
 */
async function route(live, mock) {
  const which = await source();
  if (which === 'mock') return mock();

  try {
    return await live();
  } catch (err) {
    if (mode === 'auto' && err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      resolvedSource = 'mock';
      return mock();
    }
    throw err;
  }
}

/*
 * ─────────────────────────── shape adapters ───────────────────────────
 *
 * The service answers in snake_case and the screens read camelCase, and the
 * translation belongs here rather than in a component. Each one is written
 * against the shape the care module is specified to return; if it returns
 * something else, this is the file that is wrong, which is the point.
 */

const asRecipient = (row) => ({
  id: row.id,
  reference: row.reference ?? null,
  fullName: row.fullName ?? row.full_name,
  age: row.age ?? null,
  dateOfBirth: row.dateOfBirth ?? row.date_of_birth ?? null,
  conditions: row.conditions ?? [],
  status: row.status ?? 'stable',
  address: row.address ?? row.homeAddress ?? row.home_address ?? null,
  since: row.since ?? row.startDate ?? row.start_date ?? null,
  visitCount: row.visitCount ?? row.visit_count ?? 0,
  lastVisitAt: row.lastVisitAt ?? row.last_visit_at ?? null,
  medications: row.medications ?? [],
  careNotes: row.careNotes ?? row.care_notes ?? [],
  emergencyContacts: row.emergencyContacts ?? row.emergency_contacts ?? [],
});

const asVisit = (row) => ({
  id: row.id,
  recipientId: row.recipientId ?? row.recipient_id,
  recipientName: row.recipientName ?? row.recipient_name ?? null,
  recipientReference: row.recipientReference ?? row.recipient_reference ?? null,
  recipientStatus: row.recipientStatus ?? row.recipient_status ?? null,
  recipientAddress: row.recipientAddress ?? row.recipient_address ?? null,
  kind: row.kind ?? 'Visit',
  location: row.location ?? null,
  scheduledFor: row.scheduledFor ?? row.scheduled_for,
  status: row.status ?? 'upcoming',
  checkInAt: row.checkInAt ?? row.check_in_at ?? null,
  checkOutAt: row.checkOutAt ?? row.check_out_at ?? null,
  tasks: (row.tasks ?? []).map((t) => ({
    id: t.id, label: t.label, done: Boolean(t.done),
  })),
});

/*
 * ─────────────────────────── the calls ───────────────────────────
 */

export const care = {
  /**
   * Everything the home dashboard draws, in one request.
   *
   * One call rather than four, because the dashboard has four sections and a
   * caregiver opening the app on a bad connection should wait once, not watch
   * four spinners resolve at four different moments.
   */
  dashboard: () => route(
    async () => {
      const payload = await api.authed.get('/care/dashboard');
      return {
        sessionRisk: payload.sessionRisk ?? null,
        counts: payload.counts ?? { assigned: 0, visitsToday: 0, completedToday: 0 },
        recipients: (payload.recipients ?? []).map((r) => ({
          ...asRecipient(r),
          nextVisitAt: r.nextVisitAt ?? r.next_visit_at ?? null,
          nextVisitId: r.nextVisitId ?? r.next_visit_id ?? null,
        })),
        visits: (payload.visits ?? []).map(asVisit),
        alerts: payload.alerts ?? [],
      };
    },
    () => mockCaregiverApi.dashboard()
  ),

  /**
   * The people this caregiver is assigned to.
   *
   * Scoping is the service's job, not a filter applied here: GET /profiles
   * already resolves to the caregiver's active assignments at the database,
   * and the care module's /care/assignments is specified to do the same. A
   * client-side filter would be a check that anyone with the app can remove.
   */
  assignments: () => route(
    async () => {
      const payload = await api.authed.get('/care/assignments');
      const recipients = (payload.recipients ?? payload.profiles ?? []).map(asRecipient);
      return {
        count: payload.count ?? recipients.length,
        active: payload.active ?? recipients.filter((r) => r.status !== 'inactive').length,
        recipients,
      };
    },
    () => mockCaregiverApi.assignments()
  ),

  recipient: (id) => route(
    async () => asRecipient((await api.authed.get(`/care/recipients/${id}`)).recipient),
    () => mockCaregiverApi.recipient(id)
  ),

  visits: (params = {}) => route(
    async () => {
      const query = params.recipientId ? `?recipientId=${encodeURIComponent(params.recipientId)}` : '';
      const payload = await api.authed.get(`/care/visits${query}`);
      return { visits: (payload.visits ?? []).map(asVisit) };
    },
    () => mockCaregiverApi.visits(params)
  ),

  visit: (id) => route(
    async () => asVisit((await api.authed.get(`/care/visits/${id}`)).visit),
    () => mockCaregiverApi.visit(id)
  ),

  /** Tick or untick one task. The caller has already drawn the new state; see useOptimisticTasks. */
  setTask: (visitId, taskId, done) => route(
    async () => asVisit((await api.authed.post(`/care/visits/${visitId}/tasks/${taskId}`, { done })).visit),
    () => mockCaregiverApi.setTask(visitId, taskId, done)
  ),

  checkIn: (visitId) => route(
    async () => asVisit((await api.authed.post(`/care/visits/${visitId}/check-in`, {})).visit),
    () => mockCaregiverApi.checkIn(visitId)
  ),

  checkOut: (visitId) => route(
    async () => asVisit((await api.authed.post(`/care/visits/${visitId}/check-out`, {})).visit),
    () => mockCaregiverApi.checkOut(visitId)
  ),

  /** File a visit report. Closes the visit and appends its note to the care record. */
  submitReport: (payload) => route(
    async () => (await api.authed.post('/care/reports', payload)).report,
    () => mockCaregiverApi.submitReport(payload)
  ),

  /** A care note, or -- with kind: 'incident' -- an incident report. */
  addCareNote: (payload) => route(
    async () => (await api.authed.post(`/care/recipients/${payload.recipientId}/notes`, payload)).note,
    () => mockCaregiverApi.addCareNote(payload)
  ),
};
