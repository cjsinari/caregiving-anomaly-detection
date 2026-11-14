/*
 * The caregiver dataset, in memory.
 *
 * ── Why this file exists ──
 *
 * Issue #44 says in as many words that the screens have to work against a mock
 * API if the backend module is not ready, and it is not: `auth-service` has
 * care profiles and assignments (profileRoutes.js) but no visits, no tasks, no
 * care notes, no check-in and no emergency contacts. Four of the issue's seven
 * checklist items have no endpoint behind them, and will not until the care
 * module lands.
 *
 * So this is not a fixture for tests. It is the app's data source on a laptop
 * with no care module running, and it is held to the same standard as the
 * service it stands in for:
 *
 *   - It is *stateful*. Ticking a task, checking in, filing a report: all of
 *     them mutate this store and are still true on the next screen. A mock
 *     that answers every read with the same constant cannot show an optimistic
 *     update being confirmed, which is the one behaviour #44 names in its
 *     acceptance criteria.
 *   - It is *slow*, by a little. Every call sleeps. Loading states that never
 *     appear in development are loading states nobody notices are broken.
 *   - It can be made to *fail*, on demand (see `mockControls`). The error
 *     state of every list, and the rollback of an optimistic write, are
 *     reachable by hand rather than only in a test.
 *
 * Nothing here is real patient data. The names are the ones on the approved
 * mockups, the conditions are generic, and the phone numbers sit in a range
 * reserved for documentation.
 */

import * as session from '../../auth/session';

/** A time of day on a given date, as an ISO timestamp. */
function at(day, hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function daysFromToday(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

const TODAY = () => daysFromToday(0);
const TOMORROW = () => daysFromToday(1);

/*
 * The seed.
 *
 * Built fresh on each reset rather than held as a frozen literal, because the
 * visit times are relative to today -- a fixture with hard-coded dates shows
 * "Today, 14:00" under a heading that says the visit was in September.
 */
function seed() {
  return {
    recipients: [
      {
        id: 'rec-001',
        reference: 'ASG-001',
        fullName: 'Margaret Wanjiku',
        age: 78,
        dateOfBirth: '1948-03-14',
        conditions: ['Diabetic', 'Hypertension'],
        status: 'stable',
        address: 'Apt 3B, Westlands Road, Nairobi',
        since: '2026-01-12',
        visitCount: 47,
        lastVisitAt: at(daysFromToday(-1), '14:20'),
        medications: [
          { id: 'med-1', name: 'Metformin', dose: '500 mg', schedule: 'Twice daily, with food', notes: 'Morning and evening' },
          { id: 'med-2', name: 'Amlodipine', dose: '5 mg', schedule: 'Once daily, morning', notes: null },
          { id: 'med-3', name: 'Atorvastatin', dose: '20 mg', schedule: 'Once daily, bedtime', notes: null },
        ],
        careNotes: [
          {
            id: 'note-1',
            author: 'Grace Wanjiru',
            at: at(daysFromToday(-1), '14:20'),
            body: 'Blood pressure 128/84. Good spirits, ate a full lunch. No falls or incidents.',
          },
          {
            id: 'note-2',
            author: 'Grace Wanjiru',
            at: at(daysFromToday(-3), '14:05'),
            body: 'Slight swelling in the left ankle. Advised to keep the leg raised; will watch it on Thursday.',
          },
        ],
        emergencyContacts: [
          { id: 'ec-1', name: 'Peter Wanjiku', relationship: 'Son', phone: '+254 700 000 101', isPrimary: true },
          { id: 'ec-2', name: 'Dr. Achieng Odhiambo', relationship: 'GP, Westlands Clinic', phone: '+254 700 000 102', isPrimary: false },
        ],
      },
      {
        id: 'rec-002',
        reference: 'ASG-002',
        fullName: 'James Ochieng',
        age: 84,
        dateOfBirth: '1942-07-02',
        conditions: ['Post-stroke recovery'],
        status: 'attention',
        address: 'House 14, Kilimani Estate, Nairobi',
        since: '2026-03-03',
        visitCount: 28,
        lastVisitAt: at(daysFromToday(-2), '09:00'),
        medications: [
          { id: 'med-4', name: 'Clopidogrel', dose: '75 mg', schedule: 'Once daily, morning', notes: null },
          { id: 'med-5', name: 'Ramipril', dose: '2.5 mg', schedule: 'Once daily, morning', notes: 'Check blood pressure before giving' },
        ],
        careNotes: [
          {
            id: 'note-3',
            author: 'Grace Wanjiru',
            at: at(daysFromToday(-2), '09:40'),
            body: 'Mobility noticeably worse on the right side this week. Family informed; physiotherapy review requested.',
          },
        ],
        emergencyContacts: [
          { id: 'ec-3', name: 'Alice Ochieng', relationship: 'Daughter', phone: '+254 700 000 103', isPrimary: true },
        ],
      },
      {
        id: 'rec-003',
        reference: 'ASG-003',
        fullName: 'Esther Muthoni',
        age: 71,
        dateOfBirth: '1955-11-23',
        conditions: ["Alzheimer's (mild)"],
        status: 'stable',
        address: 'Bungalow 7, Karen, Nairobi',
        since: '2026-04-28',
        visitCount: 15,
        lastVisitAt: at(daysFromToday(-4), '10:30'),
        medications: [
          { id: 'med-6', name: 'Donepezil', dose: '10 mg', schedule: 'Once daily, bedtime', notes: null },
        ],
        careNotes: [
          {
            id: 'note-4',
            author: 'Grace Wanjiru',
            at: at(daysFromToday(-4), '11:10'),
            body: 'Recognised me straight away today. Completed the memory exercises without prompting.',
          },
        ],
        emergencyContacts: [
          { id: 'ec-4', name: 'Samuel Muthoni', relationship: 'Husband', phone: '+254 700 000 104', isPrimary: true },
          { id: 'ec-5', name: 'Karen Community Clinic', relationship: 'Clinic', phone: '+254 700 000 105', isPrimary: false },
        ],
      },
    ],

    visits: [
      {
        id: 'visit-001',
        recipientId: 'rec-001',
        kind: 'Daily check-in',
        location: 'Westlands, Nairobi',
        scheduledFor: at(TODAY(), '14:00'),
        status: 'upcoming',
        checkInAt: null,
        checkOutAt: null,
        tasks: [
          { id: 'task-1', label: 'Medication', done: false },
          { id: 'task-2', label: 'Meals', done: false },
          { id: 'task-3', label: 'Hygiene', done: false },
          { id: 'task-4', label: 'Exercise', done: false },
          { id: 'task-5', label: 'Vitals Check', done: false },
        ],
      },
      {
        id: 'visit-002',
        recipientId: 'rec-002',
        kind: 'Medication assist',
        location: 'Kilimani, Nairobi',
        scheduledFor: at(TODAY(), '16:30'),
        status: 'upcoming',
        checkInAt: null,
        checkOutAt: null,
        tasks: [
          { id: 'task-6', label: 'Medication', done: false },
          { id: 'task-7', label: 'Mobility exercises', done: false },
          { id: 'task-8', label: 'Vitals Check', done: false },
        ],
      },
      {
        id: 'visit-003',
        recipientId: 'rec-003',
        kind: 'Morning visit',
        location: 'Karen, Nairobi',
        scheduledFor: at(TODAY(), '10:30'),
        status: 'completed',
        checkInAt: at(TODAY(), '10:28'),
        checkOutAt: at(TODAY(), '11:35'),
        tasks: [
          { id: 'task-9', label: 'Medication', done: true },
          { id: 'task-10', label: 'Meals', done: true },
          { id: 'task-11', label: 'Memory exercises', done: true },
        ],
      },
      {
        id: 'visit-004',
        recipientId: 'rec-002',
        kind: 'Daily check-in',
        location: 'Kilimani, Nairobi',
        scheduledFor: at(TOMORROW(), '09:00'),
        status: 'upcoming',
        checkInAt: null,
        checkOutAt: null,
        tasks: [
          { id: 'task-12', label: 'Medication', done: false },
          { id: 'task-13', label: 'Meals', done: false },
        ],
      },
    ],

    alerts: [
      {
        id: 'alert-1',
        tone: 'warning',
        recipientId: 'rec-002',
        title: 'James Ochieng needs attention',
        body: 'Mobility was flagged as worsening at the last two visits. A physiotherapy review is outstanding.',
        at: at(daysFromToday(-2), '09:40'),
      },
    ],

    reports: [],

    /*
     * The risk badge on the dashboard.
     *
     * The real value belongs to the risk engine, which scores the session on
     * the service side. `/auth/me` does not return it today, so until it does
     * this is the mock's answer, and the screen treats a missing value as "no
     * badge" rather than inventing a reassuring one.
     */
    sessionRisk: { level: 'low', label: 'Low Risk' },
  };
}

let store = seed();

/*
 * Development switches.
 *
 * `failFor` makes the next N calls throw, which is how the error state of a
 * list and the rollback of an optimistic write get looked at rather than
 * assumed. `latencyMs` is the simulated round trip. Both are reachable from a
 * test and from a debug build; neither is wired to a visible control, because
 * a fail-the-API toggle in a caregiver's UI is not a feature.
 */
export const mockControls = {
  latencyMs: 420,
  failNext: 0,
  failAlways: false,
  reset() {
    store = seed();
    this.failNext = 0;
    this.failAlways = false;
    this.latencyMs = 420;
  },
  /** Make the next `n` calls fail. */
  failFor(n = 1) { this.failNext = n; },
  snapshot() { return store; },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every caller gets its own copy, so no screen can mutate the store by accident. */
const clone = (value) => JSON.parse(JSON.stringify(value));

export class MockApiError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MockApiError';
    this.code = 'MOCK_FAILURE';
    this.status = 503;
  }
}

/*
 * The mock's version of requireActiveRole({ roles: ['caregiver'] }).
 *
 * Only a *known* other role is refused. With no stored user -- a unit test of
 * this module -- there is nobody to refuse. The family mock does the same in
 * the other direction, so neither portal's data can be read by the other's
 * session even before the real care module exists to enforce it.
 */
function assertCaregiver() {
  const role = session.getStoredUser()?.role;
  if (role && role !== 'caregiver') {
    const err = new MockApiError('This is only available to caregivers.');
    err.status = 403;
    err.code = 'ROLE_FORBIDDEN';
    throw err;
  }
}

async function call(fn) {
  await sleep(mockControls.latencyMs);
  assertCaregiver();
  if (mockControls.failAlways || mockControls.failNext > 0) {
    if (mockControls.failNext > 0) mockControls.failNext -= 1;
    throw new MockApiError('The care service is not responding. Please try again.');
  }
  return clone(fn());
}

const sameDay = (iso, day) => {
  const a = new Date(iso);
  return a.getFullYear() === day.getFullYear()
    && a.getMonth() === day.getMonth()
    && a.getDate() === day.getDate();
};

const findRecipient = (id) => {
  const found = store.recipients.find((r) => r.id === id);
  if (!found) throw new MockApiError('That care recipient is not on your list.');
  return found;
};

const findVisit = (id) => {
  const found = store.visits.find((v) => v.id === id);
  if (!found) throw new MockApiError('That visit no longer exists.');
  return found;
};

/** A visit with its recipient's details folded in, which is what every list shows. */
function decorate(visit) {
  const recipient = store.recipients.find((r) => r.id === visit.recipientId);
  return {
    ...visit,
    recipientName: recipient ? recipient.fullName : 'Unknown',
    recipientReference: recipient ? recipient.reference : null,
    recipientStatus: recipient ? recipient.status : null,
    recipientAddress: recipient ? recipient.address : null,
  };
}

export const mockCaregiverApi = {
  /** Everything the home dashboard draws, in one call, as a real endpoint would. */
  dashboard: () => call(() => {
    const today = TODAY();
    const todays = store.visits.filter((v) => sameDay(v.scheduledFor, today));
    return {
      sessionRisk: store.sessionRisk,
      counts: {
        assigned: store.recipients.length,
        visitsToday: todays.length,
        completedToday: todays.filter((v) => v.status === 'completed').length,
      },
      recipients: store.recipients.map((r) => {
        const next = store.visits
          .filter((v) => v.recipientId === r.id && v.status !== 'completed')
          .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))[0];
        return {
          id: r.id,
          fullName: r.fullName,
          age: r.age,
          conditions: r.conditions,
          status: r.status,
          nextVisitAt: next ? next.scheduledFor : null,
          nextVisitId: next ? next.id : null,
        };
      }),
      visits: todays
        .slice()
        .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
        .map(decorate),
      alerts: store.alerts,
    };
  }),

  assignments: () => call(() => ({
    count: store.recipients.length,
    active: store.recipients.filter((r) => r.status !== 'inactive').length,
    recipients: store.recipients,
  })),

  recipient: (id) => call(() => findRecipient(id)),

  visits: ({ recipientId } = {}) => call(() => ({
    visits: store.visits
      .filter((v) => !recipientId || v.recipientId === recipientId)
      .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
      .map(decorate),
  })),

  visit: (id) => call(() => decorate(findVisit(id))),

  setTask: (visitId, taskId, done) => call(() => {
    const visit = findVisit(visitId);
    const task = visit.tasks.find((t) => t.id === taskId);
    if (!task) throw new MockApiError('That task is no longer on this visit.');
    task.done = Boolean(done);
    return decorate(visit);
  }),

  checkIn: (visitId) => call(() => {
    const visit = findVisit(visitId);
    if (visit.checkInAt) return decorate(visit);
    visit.checkInAt = new Date().toISOString();
    visit.status = 'in_progress';
    return decorate(visit);
  }),

  checkOut: (visitId) => call(() => {
    const visit = findVisit(visitId);
    if (!visit.checkInAt) throw new MockApiError('Check in before checking out.');
    visit.checkOutAt = new Date().toISOString();
    visit.status = 'completed';
    return decorate(visit);
  }),

  /*
   * File the report.
   *
   * It closes the visit, appends the note to the recipient's care record and
   * bumps the visit count, because that is what filing one does. A mock that
   * accepted the report and changed nothing would let a broken "did it save?"
   * through to the real implementation.
   */
  submitReport: (payload) => call(() => {
    const visit = payload.visitId ? findVisit(payload.visitId) : null;
    const recipient = findRecipient(payload.recipientId);

    const report = {
      id: `report-${store.reports.length + 1}`,
      ...payload,
      filedAt: new Date().toISOString(),
    };
    store.reports.push(report);

    if (payload.notes && payload.notes.trim()) {
      recipient.careNotes.unshift({
        id: `note-${Date.now()}`,
        author: payload.filedBy || 'You',
        at: report.filedAt,
        body: payload.notes.trim(),
      });
    }

    if (visit) {
      visit.status = 'completed';
      visit.checkInAt = payload.checkInAt || visit.checkInAt;
      visit.checkOutAt = payload.checkOutAt || new Date().toISOString();
      if (Array.isArray(payload.tasks)) {
        visit.tasks = visit.tasks.map((t) => ({ ...t, done: payload.tasks.includes(t.id) }));
      }
    }

    recipient.visitCount += 1;
    recipient.lastVisitAt = report.filedAt;

    return report;
  }),

  /** An incident report is a care note the record keeps flagged. */
  addCareNote: ({ recipientId, body, kind = 'note', author }) => call(() => {
    const recipient = findRecipient(recipientId);
    const note = {
      id: `note-${Date.now()}`,
      author: author || 'You',
      at: new Date().toISOString(),
      body: String(body).trim(),
      kind,
    };
    recipient.careNotes.unshift(note);
    return note;
  }),
};
