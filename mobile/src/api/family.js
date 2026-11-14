import { api } from './client';
import { route } from './careSource';
import { mockFamilyApi } from './mock/familyData';

/*
 * Every call the family screens make.
 *
 * ── Two sources, on purpose ──
 *
 * Care data -- the feed, the care plan, the schedule, the caregiver card --
 * has no endpoint yet and goes through careSource.route, the same live-or-mock
 * decision the caregiver portal uses (read careSource.js for why it is one
 * decision and why a 500 never falls back to fixtures).
 *
 * Account notifications are different: GET /auth/notifications exists today
 * and is always called live. Those are the service's security notices -- a
 * new device trusted, a session ended for impossible travel, an account
 * frozen -- and they are exactly the ones that must never be replaced by a
 * fixture. A family member told by a mock that nothing has happened to their
 * account, on the day somebody else signed into it, is the worst thing this
 * screen could do.
 *
 * ── There is nothing here that writes care data ──
 *
 * The issue says family members must not be able to edit care data, and the
 * service already refuses it (a caregiver's notes and visit records belong to
 * the care team; ownership.js). The second line of defence is that this file
 * has no function that could ask: no setTask, no addCareNote, no PATCH on a
 * care record. A screen cannot call what does not exist, and
 * family.test.js fails if one is ever added.
 *
 * ── Scoping is the service's, not the app's ──
 *
 * "Each one should see only the recipients linked to their own account" is
 * enforced where it can be enforced: the service scopes GET /profiles to the
 * profiles the caller owns (resourceAccess.listAccessibleProfiles), and the
 * care module's /family routes are specified to do the same. Nothing here
 * filters by owner, because a filter on the phone is a filter anybody holding
 * the phone can remove.
 */

/*
 * ─────────────────────────── shape adapters ───────────────────────────
 */

const asUpdate = (row) => ({
  id: row.id,
  kind: row.kind ?? 'note',
  at: row.at ?? row.created_at,
  title: row.title ?? null,
  body: row.body ?? '',
  author: row.author ?? row.author_name ?? null,
  severity: row.severity ?? null,
  visit: row.visit ? {
    checkInAt: row.visit.checkInAt ?? row.visit.check_in_at ?? null,
    checkOutAt: row.visit.checkOutAt ?? row.visit.check_out_at ?? null,
    wellbeing: row.visit.wellbeing ?? null,
    tasksDone: row.visit.tasksDone ?? row.visit.tasks_done ?? null,
    tasksTotal: row.visit.tasksTotal ?? row.visit.tasks_total ?? null,
  } : null,
});

const asCaregiver = (row) => (row ? {
  id: row.id,
  fullName: row.fullName ?? row.full_name,
  role: row.role ?? 'Caregiver',
  phone: row.phone ?? row.phoneNumber ?? row.phone_number ?? null,
  since: row.since ?? row.startDate ?? row.start_date ?? null,
  isPrimary: Boolean(row.isPrimary ?? row.is_primary),
} : null);

/*
 * The service's account notices, as the notification list shows them.
 *
 * Titles are written here rather than taken from the message, because the
 * message is an SMS body ("MzaziCare: we signed you out because…") and the
 * brand prefix is noise once it is inside the app that *is* the brand.
 */
const ACCOUNT_TITLES = {
  login_blocked: 'Sign-in blocked',
  session_flagged_geo: 'Signed out for your safety',
  session_flagged_api_velocity: 'Signed out for your safety',
  impossible_travel_login: 'Sign-in needed extra checks',
  new_device_trusted: 'New device added',
  account_frozen: 'Account locked',
  account_restored: 'Account restored',
  otp_lockout: 'Too many code attempts',
  account_recovered: 'Account recovered',
};

const asAccountNotification = (row) => ({
  id: `account-${row.id}`,
  sourceId: row.id,
  category: 'account',
  title: ACCOUNT_TITLES[row.type] || 'Account notice',
  message: String(row.message || '').replace(/^MzaziCare:\s*/i, ''),
  severity: row.severity ?? null,
  createdAt: row.createdAt ?? row.created_at,
  readAt: row.readAt ?? row.read_at ?? null,
});

const asCareNotification = (row) => ({
  id: `care-${row.id}`,
  sourceId: row.id,
  category: row.category ?? 'visit',
  recipientId: row.recipientId ?? row.recipient_id ?? null,
  title: row.title ?? 'Care update',
  message: row.message ?? '',
  severity: row.severity ?? null,
  createdAt: row.createdAt ?? row.created_at,
  readAt: row.readAt ?? row.read_at ?? null,
});

/*
 * ─────────────────────────── the calls ───────────────────────────
 */

export const family = {
  /** The loved ones linked to this account. */
  recipients: () => route(
    async () => {
      const payload = await api.authed.get('/family/recipients');
      return { recipients: payload.recipients ?? [] };
    },
    () => mockFamilyApi.recipients()
  ),

  /**
   * Everything the home dashboard draws for one loved one, in one request,
   * for the same reason the caregiver dashboard is one request: one skeleton,
   * one error, one pull-to-refresh that genuinely refreshes everything.
   */
  overview: (recipientId) => route(
    async () => {
      const p = await api.authed.get(`/family/recipients/${recipientId}/overview`);
      return {
        recipient: p.recipient,
        lastVisit: p.lastVisit ? asUpdate(p.lastVisit) : null,
        nextVisit: p.nextVisit ?? null,
        caregiver: asCaregiver(p.caregiver),
        latestUpdates: (p.latestUpdates ?? []).map(asUpdate),
        unreadNotifications: p.unreadNotifications ?? 0,
      };
    },
    () => mockFamilyApi.overview(recipientId)
  ),

  /** One page of the care updates feed, newest first. `cursor` is opaque. */
  updates: ({ recipientId, cursor = null, limit = 10, kind = null }) => route(
    async () => {
      const query = new URLSearchParams({ limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      if (kind) query.set('kind', kind);
      const p = await api.authed.get(`/family/recipients/${recipientId}/updates?${query}`);
      return { items: (p.items ?? []).map(asUpdate), nextCursor: p.nextCursor ?? null };
    },
    () => mockFamilyApi.updates({ recipientId, cursor, limit, kind })
  ),

  /** The read-only profile and care plan. */
  recipient: (recipientId) => route(
    async () => {
      const { recipient: r } = await api.authed.get(`/family/recipients/${recipientId}`);
      return { ...r, caregivers: (r.caregivers ?? []).map(asCaregiver) };
    },
    () => mockFamilyApi.recipient(recipientId)
  ),

  /** Upcoming visits, soonest first. */
  schedule: (recipientId) => route(
    async () => {
      const p = await api.authed.get(`/family/recipients/${recipientId}/schedule`);
      return { visits: p.visits ?? [] };
    },
    () => mockFamilyApi.schedule(recipientId)
  ),

  /**
   * Care notifications and account notices, as one list.
   *
   * Loaded side by side and merged by time. Either half failing does not take
   * the other with it: a care service having a bad minute must not hide the
   * notice that someone signed into this account from another country, and
   * the reverse. `partial` says which half is missing, so the screen can say
   * so instead of presenting half a list as the whole one.
   */
  notifications: async () => {
    const [careResult, accountResult] = await Promise.allSettled([
      route(
        async () => api.authed.get('/family/notifications'),
        () => mockFamilyApi.notifications()
      ),
      api.authed.get('/auth/notifications'),
    ]);

    if (careResult.status === 'rejected' && accountResult.status === 'rejected') {
      throw careResult.reason;
    }

    const care = careResult.status === 'fulfilled'
      ? (careResult.value.notifications ?? []).map(asCareNotification)
      : [];
    const account = accountResult.status === 'fulfilled'
      ? (accountResult.value.notifications ?? []).map(asAccountNotification)
      : [];

    return {
      items: [...care, ...account].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      partial: careResult.status === 'rejected'
        ? 'care'
        : accountResult.status === 'rejected' ? 'account' : null,
    };
  },

  /** Mark everything read, in both places. */
  markNotificationsRead: async () => {
    const results = await Promise.allSettled([
      route(
        async () => api.authed.post('/family/notifications/read', {}),
        () => mockFamilyApi.markNotificationsRead()
      ),
      api.authed.post('/auth/notifications/read', {}),
    ]);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    return { ok: true };
  },
};
