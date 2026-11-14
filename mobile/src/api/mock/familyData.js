import * as session from '../../auth/session';

/*
 * The family member's view of the care dataset, in memory.
 *
 * ── Why this exists ──
 *
 * Same reason as caregiverData.js: the service has care profiles and
 * assignments but no care module, so there is no feed of completed visits, no
 * care plan, no schedule and no care notifications to read. Issue #45 needs
 * all four. This answers in the shapes the care module is specified to answer
 * in, so the screens never learn which source they were reading.
 *
 * Held to the same standard as the caregiver mock:
 *
 *   - It is *stateful*. A notification marked read stays read; an update
 *     pushed in (`mockFamilyControls.addUpdate`) is at the top of the feed on
 *     the next pull-to-refresh, which is the only way to see that the refresh
 *     actually fetches rather than re-renders.
 *   - It is *paged* for real. Thirty-odd updates across three weeks, served
 *     ten at a time behind a cursor, so infinite scroll has several pages to
 *     load and an end to reach.
 *   - It is *slow*, by a little, and can be made to *fail* on demand, so the
 *     loading and error states -- including an error on page three of the
 *     feed, with pages one and two still on screen -- can be looked at.
 *   - It *refuses the wrong role*, as the service does. A family endpoint
 *     asked by a caregiver's session answers 403, mirroring
 *     requireActiveRole on the service. A mock that served anybody would let
 *     a portal mix-up through to the real implementation unnoticed.
 *
 * Nothing here is real patient data. The names match the caregiver mock and
 * the approved mockups; the phone numbers sit in a range reserved for
 * documentation.
 */

/** A time of day on a date relative to today, as an ISO timestamp. */
function at(dayOffset, hhmm) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

const CAREGIVER = {
  id: 'cg-001',
  fullName: 'Grace Wanjiru',
  role: 'Lead caregiver',
  phone: '+254 700 000 201',
  since: '2026-01-12',
  isPrimary: true,
};

const RELIEF = {
  id: 'cg-002',
  fullName: 'Daniel Kiprop',
  role: 'Relief caregiver, weekends',
  phone: '+254 700 000 202',
  since: '2026-06-01',
  isPrimary: false,
};

/*
 * Three weeks of care, generated so the feed has pages to scroll through.
 *
 * Deterministic -- no Math.random -- so a test that scrolls to page three gets
 * the same page three every time, and so the demo does not show a different
 * history on every reload, which would look like data loss.
 */
function buildUpdates() {
  const notes = [
    'Good spirits today. Ate a full lunch and walked to the gate unaided.',
    'Blood pressure 128/84. Took afternoon medication without fuss.',
    'A little tired after a poor night. Rested in the afternoon; no other concerns.',
    'Enjoyed the radio and talked about the garden. Appetite good.',
    'Blood sugar 6.8 before lunch, within her target range.',
    'Slight swelling in the left ankle. Leg kept raised; will check again next visit.',
    'Did her chair exercises and asked to do them again tomorrow.',
  ];
  const wellbeings = ['well', 'well', 'okay', 'well', 'well', 'okay', 'well'];
  const items = [];

  // Visits, morning or afternoon, most days for three weeks.
  for (let day = 1; day <= 21; day += 1) {
    if (day % 7 === 0) continue;             // a rest day each week
    const i = day % notes.length;
    const afternoon = day % 2 === 0;
    const checkIn = at(-day, afternoon ? '14:02' : '10:01');
    const checkOut = at(-day, afternoon ? '15:08' : '11:04');
    const caregiver = day % 6 === 0 ? RELIEF : CAREGIVER;

    items.push({
      id: `upd-visit-${day}`,
      kind: 'visit',
      at: checkOut,
      title: afternoon ? 'Afternoon visit completed' : 'Morning visit completed',
      body: notes[i],
      author: caregiver.fullName,
      visit: {
        checkInAt: checkIn,
        checkOutAt: checkOut,
        wellbeing: wellbeings[i],
        tasksDone: day % 5 === 0 ? 4 : 5,
        tasksTotal: 5,
      },
    });
  }

  // A few standalone care notes between visits.
  [3, 9, 16].forEach((day) => {
    items.push({
      id: `upd-note-${day}`,
      kind: 'note',
      at: at(-day, '18:30'),
      title: 'Care note',
      body: day === 9
        ? 'Spoke to the clinic about the ankle swelling. They will review at her next appointment.'
        : 'Pharmacy delivery received and checked against the medication list.',
      author: CAREGIVER.fullName,
    });
  });

  // One incident, handled, so the feed shows what one looks like.
  items.push({
    id: 'upd-incident-12',
    kind: 'incident',
    at: at(-12, '15:20'),
    title: 'Incident reported',
    body: 'At 15:10 she slipped getting out of the chair. No injury; I helped her up and '
      + 'checked for bruising. Her son was informed by phone at 15:20.',
    author: CAREGIVER.fullName,
    severity: 'low',
  });

  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function seed() {
  return {
    recipients: [
      {
        id: 'rec-001',
        fullName: 'Margaret Wanjiku',
        relationship: 'Mother',
        age: 78,
        dateOfBirth: '1948-03-14',
        address: 'Apt 3B, Westlands Road, Nairobi',
        conditions: ['Type 2 diabetes', 'Hypertension'],
        status: 'stable',
        statusNote: 'Settled and well over the past week. Ankle swelling being watched.',
        careStartedOn: '2026-01-12',
        carePlan: {
          summary: 'Daily support at home to manage diabetes and blood pressure, keep her '
            + 'mobile, and make sure she is eating well.',
          goals: [
            'Blood sugar kept within her target range',
            'Walking to the gate unaided, most days',
            'Two full meals a day, with fluids',
          ],
          routine: [
            { id: 'r1', label: 'Medication', frequency: 'Every visit' },
            { id: 'r2', label: 'Meals', frequency: 'Every visit' },
            { id: 'r3', label: 'Hygiene', frequency: 'Daily' },
            { id: 'r4', label: 'Chair exercises', frequency: 'Daily' },
            { id: 'r5', label: 'Blood pressure and sugar check', frequency: 'Every visit' },
          ],
          medications: [
            { id: 'med-1', name: 'Metformin', dose: '500 mg', schedule: 'Twice daily, with food' },
            { id: 'med-2', name: 'Amlodipine', dose: '5 mg', schedule: 'Once daily, morning' },
            { id: 'med-3', name: 'Atorvastatin', dose: '20 mg', schedule: 'Once daily, bedtime' },
          ],
          dietary: 'Low sugar. Prefers ugali and greens; no added salt.',
          mobility: 'Walks with a stick indoors. Needs a hand on steps.',
          reviewedOn: '2026-10-30',
        },
        emergencyContacts: [
          { id: 'ec-1', name: 'Peter Wanjiku', relationship: 'Son', phone: '+254 700 000 101', isPrimary: true },
          { id: 'ec-2', name: 'Dr. Achieng Odhiambo', relationship: 'GP, Westlands Clinic', phone: '+254 700 000 102', isPrimary: false },
        ],
        caregivers: [CAREGIVER, RELIEF],
      },
    ],

    updates: { 'rec-001': buildUpdates() },

    schedule: {
      'rec-001': [
        { id: 'visit-001', at: at(0, '14:00'), kind: 'Daily check-in', caregiver: CAREGIVER.fullName, status: 'upcoming' },
        { id: 'visit-005', at: at(1, '10:00'), kind: 'Morning visit', caregiver: CAREGIVER.fullName, status: 'upcoming' },
        { id: 'visit-006', at: at(2, '14:00'), kind: 'Daily check-in', caregiver: CAREGIVER.fullName, status: 'upcoming' },
        { id: 'visit-007', at: at(3, '10:00'), kind: 'Morning visit', caregiver: CAREGIVER.fullName, status: 'upcoming' },
        { id: 'visit-008', at: at(5, '11:00'), kind: 'Weekend visit', caregiver: RELIEF.fullName, status: 'upcoming' },
        { id: 'visit-009', at: at(7, '14:00'), kind: 'Daily check-in', caregiver: CAREGIVER.fullName, status: 'upcoming' },
        { id: 'visit-010', at: at(9, '09:30'), kind: 'Clinic escort', caregiver: CAREGIVER.fullName, status: 'upcoming', note: 'Ankle review at Westlands Clinic' },
      ],
    },

    notifications: [
      {
        id: 'cn-1', category: 'visit', recipientId: 'rec-001',
        title: 'Visit completed', message: 'Grace Wanjiru finished the morning visit. Margaret was well.',
        createdAt: at(-1, '11:05'), readAt: null,
      },
      {
        id: 'cn-2', category: 'schedule', recipientId: 'rec-001',
        title: 'Visit added', message: 'A clinic escort has been booked for the ankle review.',
        createdAt: at(-2, '16:40'), readAt: null,
      },
      {
        id: 'cn-3', category: 'incident', recipientId: 'rec-001',
        title: 'Incident reported', message: 'Margaret slipped getting out of her chair. No injury.',
        createdAt: at(-12, '15:21'), readAt: at(-12, '15:40'),
      },
      {
        id: 'cn-4', category: 'note', recipientId: 'rec-001',
        title: 'New care note', message: 'Grace spoke to the clinic about the ankle swelling.',
        createdAt: at(-9, '18:31'), readAt: at(-9, '20:02'),
      },
    ],
  };
}

let store = seed();

export const mockFamilyControls = {
  latencyMs: 380,
  failNext: 0,
  reset() {
    store = seed();
    this.failNext = 0;
    this.latencyMs = 380;
  },
  /** Make the next `n` calls fail. */
  failFor(n = 1) { this.failNext = n; },
  /** Put a new update at the top of a feed, as a newly filed visit report would. */
  addUpdate(recipientId, update) {
    const item = { id: `upd-new-${Date.now()}`, at: new Date().toISOString(), ...update };
    store.updates[recipientId] = [item, ...(store.updates[recipientId] || [])];
    return item;
  },
  snapshot() { return store; },
};

export class MockFamilyError extends Error {
  constructor(message, { status = 503, code = 'MOCK_FAILURE' } = {}) {
    super(message);
    this.name = 'MockFamilyError';
    this.status = status;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => JSON.parse(JSON.stringify(value));

/*
 * The mock's version of requireActiveRole({ roles: ['family'] }).
 *
 * Only refuses a *known* other role. With no stored user at all -- a unit
 * test of this module, say -- there is nobody to refuse, and refusing would
 * make the mock harder to test than the thing it imitates.
 */
function assertFamily() {
  const role = session.getStoredUser()?.role;
  if (role && role !== 'family') {
    throw new MockFamilyError('This is only available to family members.', {
      status: 403, code: 'ROLE_FORBIDDEN',
    });
  }
}

async function call(fn) {
  await sleep(mockFamilyControls.latencyMs);
  assertFamily();
  if (mockFamilyControls.failNext > 0) {
    mockFamilyControls.failNext -= 1;
    throw new MockFamilyError('The care service is not responding. Please try again.');
  }
  return clone(fn());
}

const findRecipient = (id) => {
  const found = store.recipients.find((r) => r.id === id);
  if (!found) {
    // The service answers a profile you are not linked to exactly as it
    // answers one that does not exist, so its existence is not disclosed.
    throw new MockFamilyError('Care profile not found.', { status: 404, code: 'NOT_FOUND' });
  }
  return found;
};

export const mockFamilyApi = {
  /** The loved ones linked to this account. */
  recipients: () => call(() => ({
    recipients: store.recipients.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      relationship: r.relationship,
      age: r.age,
      status: r.status,
    })),
  })),

  /** What the home dashboard draws for one loved one, in one request. */
  overview: (recipientId) => call(() => {
    const r = findRecipient(recipientId);
    const feed = store.updates[recipientId] || [];
    const lastVisit = feed.find((u) => u.kind === 'visit') || null;
    const now = Date.now();
    const nextVisit = (store.schedule[recipientId] || [])
      .filter((v) => new Date(v.at).getTime() >= now - 60 * 60 * 1000)
      .sort((a, b) => new Date(a.at) - new Date(b.at))[0] || null;

    return {
      recipient: {
        id: r.id,
        fullName: r.fullName,
        relationship: r.relationship,
        age: r.age,
        conditions: r.conditions,
        status: r.status,
        statusNote: r.statusNote,
      },
      lastVisit,
      nextVisit,
      caregiver: r.caregivers.find((c) => c.isPrimary) || r.caregivers[0] || null,
      latestUpdates: feed.slice(0, 3),
      unreadNotifications: store.notifications.filter((n) => !n.readAt).length,
    };
  }),

  /**
   * One page of the care updates feed, newest first.
   *
   * The cursor is the id of the last item already shown, not an offset. With
   * an offset, a report filed between page one and page two shifts everything
   * down by one and page two starts with the item page one ended on -- the
   * duplicate a feed is most likely to show and least likely to be tested for.
   */
  updates: ({ recipientId, cursor = null, limit = 10, kind = null }) => call(() => {
    findRecipient(recipientId);
    let feed = store.updates[recipientId] || [];
    if (kind) feed = feed.filter((u) => u.kind === kind);

    let start = 0;
    if (cursor) {
      const index = feed.findIndex((u) => u.id === cursor);
      start = index === -1 ? feed.length : index + 1;
    }
    const items = feed.slice(start, start + limit);
    const more = start + limit < feed.length;
    return { items, nextCursor: more ? items[items.length - 1].id : null };
  }),

  /** The read-only profile and care plan. */
  recipient: (recipientId) => call(() => findRecipient(recipientId)),

  /** Upcoming visits, soonest first. */
  schedule: (recipientId) => call(() => {
    findRecipient(recipientId);
    const now = Date.now();
    return {
      visits: (store.schedule[recipientId] || [])
        .filter((v) => new Date(v.at).getTime() >= now - 60 * 60 * 1000)
        .sort((a, b) => new Date(a.at) - new Date(b.at)),
    };
  }),

  /** Care notifications: visits, notes, incidents, schedule changes. */
  notifications: () => call(() => ({
    notifications: store.notifications
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  })),

  markNotificationsRead: () => call(() => {
    const stamp = new Date().toISOString();
    let updated = 0;
    store.notifications.forEach((n) => {
      if (!n.readAt) { n.readAt = stamp; updated += 1; }
    });
    return { updated };
  }),
};
