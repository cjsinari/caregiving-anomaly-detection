import { api } from './client';
import { route } from './careSource';
import { mockCaregiverApi } from './mock/caregiverData';

/*
 * Every call the caregiver screens make.
 *
 * Where the answers come from -- the service's care module, or the mock that
 * stands in for it until the module exists -- is decided once, in
 * careSource.js, for both portals. Read that file for why the whole module
 * reads from one source rather than mixing live and fixture data, and why it
 * falls back on a 404 but never on a 500 or a dead network.
 *
 * Re-exported here so the code and tests written against this file in #44 do
 * not have to move.
 */
export { careApiSource, __resetCareApiForTests } from './careSource';

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
