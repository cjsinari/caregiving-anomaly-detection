/*
 * Responses shaped exactly as the service returns them.
 *
 * Copied from live responses rather than invented, so a test that passes here
 * is evidence about the real contract. A fixture that drifts from the service
 * turns the whole suite into a test of the fixture.
 */

export const summary = {
  window: '24h',
  from: '2026-11-09T17:00:00.000Z',
  to: '2026-11-10T17:00:00.000Z',
  previousFrom: '2026-11-08T17:00:00.000Z',
  metrics: {
    logins: { value: 12, previous: 8, trend: 50 },
    failedLogins: { value: 3, previous: 9, trend: -66.7 },
    accountsSignedIn: { value: 7, previous: 6, trend: 16.7 },
    anomaliesScored: { value: 15, previous: 14, trend: 7.1 },
    anomaliesFlagged: { value: 4, previous: 0, trend: null },
    loginsBlocked: { value: 1, previous: 0, trend: null },
    stepUpsRequired: { value: 3, previous: 0, trend: null },
    sessionsBlocked: { value: 2, previous: 1, trend: 100 },
    sessionsStarted: { value: 12, previous: 8, trend: 50 },
    events: { value: 48, previous: 40, trend: 20 },
    urgentEvents: { value: 5, previous: 2, trend: 150 },
    accessDenied: { value: 2, previous: 0, trend: null },
  },
  activeSessions: 4,
  averageRiskScore: { value: 31.4, previous: 28.1 },
};

export const timeseries = {
  window: '24h',
  from: '2026-11-09T17:00:00.000Z',
  to: '2026-11-10T17:00:00.000Z',
  previousFrom: '2026-11-08T17:00:00.000Z',
  groupBy: 'eventType',
  bucketSeconds: 3600,
  bucketLabel: 'hour',
  series: [
    { key: 'login_success', label: 'Login success', total: 12 },
    { key: 'login_blocked', label: 'Login blocked', total: 1 },
    { key: 'resource_access', label: 'Resource access', total: 20 },
  ],
  points: [
    { at: 1794250800, time: '2026-11-09T19:00:00.000Z', login_success: 2, login_blocked: 0, resource_access: 5, total: 7 },
    { at: 1794254400, time: '2026-11-09T20:00:00.000Z', login_success: 4, login_blocked: 1, resource_access: 8, total: 13 },
    { at: 1794258000, time: '2026-11-09T21:00:00.000Z', login_success: 6, login_blocked: 0, resource_access: 7, total: 13 },
  ],
};

export const events = {
  window: '24h',
  from: '2026-11-09T17:00:00.000Z',
  to: '2026-11-10T17:00:00.000Z',
  previousFrom: '2026-11-08T17:00:00.000Z',
  total: 2,
  limit: 50,
  offset: 0,
  events: [
    {
      id: 'e1111111-1111-1111-1111-111111111111',
      time: '2026-11-10T16:42:12.017Z',
      eventType: 'login_blocked',
      severity: 'critical',
      explanation: 'Sign-in blocked and the account frozen as a precaution. Risk score 92.4, decided by the anomaly model.',
      actorType: 'automated',
      actor: { id: 'u1111111-1111-1111-1111-111111111111', fullName: 'Grace Wanjiku', role: 'family' },
      sessionId: null,
      ip: '41.90.64.33',
      detail: { riskScore: 92.4 },
    },
    {
      id: 'e2222222-2222-2222-2222-222222222222',
      time: '2026-11-10T16:30:00.000Z',
      eventType: 'resource_access',
      severity: 'medium',
      explanation: 'Read access to a care profile was denied: the requester has no caregiver assignment to it.',
      actorType: 'user',
      actor: { id: 'u2222222-2222-2222-2222-222222222222', fullName: 'Mary Wanjiru', role: 'caregiver' },
      sessionId: 's2222222-2222-2222-2222-222222222222',
      action: 'read',
      decision: 'deny',
      resourceType: 'elderly_profile',
      resourceId: 'p2222222-2222-2222-2222-222222222222',
      ip: '41.90.64.90',
      detail: { reason: 'no_assignment' },
    },
  ],
};

export const distribution = {
  window: '7d',
  from: '2026-11-03T17:00:00.000Z',
  to: '2026-11-10T17:00:00.000Z',
  previousFrom: '2026-10-27T17:00:00.000Z',
  bucketSize: 5,
  thresholds: { allowMax: 58.9, stepUpMax: 88, source: 'engine', modelLoaded: true },
  histogram: [
    { from: 0, to: 5, count: 9, allowed: 9, steppedUp: 0, blocked: 0 },
    { from: 60, to: 65, count: 3, allowed: 0, steppedUp: 3, blocked: 0 },
    { from: 90, to: 95, count: 1, allowed: 0, steppedUp: 0, blocked: 1 },
  ],
  byDecision: [
    { action: 'allow', governedBy: 'model', count: 9, averageScore: 3.2 },
    { action: 'step_up', governedBy: 'model', count: 3, averageScore: 62.1 },
    { action: 'block', governedBy: 'model', count: 1, averageScore: 92.4 },
  ],
  byLayer: [
    { layer: 'pre_login', label: 'Sign-in', description: 'The risk model scoring a sign-in attempt, and what it decided.', total: 20, ofConcern: 4 },
    { layer: 'resource', label: 'Resource access', description: 'Requests for care records, allowed or refused by the ownership rules.', total: 30, ofConcern: 2 },
  ],
  byRole: [
    { role: 'family', total: 30, ofConcern: 4, accounts: 3 },
    { role: 'caregiver', total: 20, ofConcern: 2, accounts: 2 },
  ],
};

export const anomalies = {
  window: '7d',
  from: '2026-11-03T17:00:00.000Z',
  to: '2026-11-10T17:00:00.000Z',
  previousFrom: '2026-10-27T17:00:00.000Z',
  total: 1,
  limit: 50,
  offset: 0,
  anomalies: [
    {
      id: 'a1111111-1111-1111-1111-111111111111',
      loginEventId: 'l1111111-1111-1111-1111-111111111111',
      time: '2026-11-10T16:42:11.000Z',
      loginTime: '2026-11-10T16:42:11.000Z',
      riskScore: 92.4,
      riskLevel: 'high',
      explanation: 'Flagged as high risk due to: unrecognised device, login from an unfamiliar country.',
      decision: {
        action: 'block', governedBy: 'model', coldStart: false,
        modelAvailable: true, loginSucceeded: false,
      },
      account: {
        id: 'u1111111-1111-1111-1111-111111111111',
        fullName: 'Grace Wanjiku', role: 'family',
        accountStatus: 'frozen', phoneNumber: '+2547****1234',
      },
      origin: {
        ip: '203.0.113.7', country: 'NG', city: 'Lagos',
        deviceFingerprint: 'device-unknown-xyz', knownDevice: false,
      },
      features: {
        login_hour: 3, time_deviation: 11.2, is_known_country: 0,
        is_known_city: 0, login_velocity: 6,
      },
      signals: [
        { feature: 'is_known_device', label: 'Device', value: 0, observed: 'not seen on this account before', contributed: true, explanation: 'A sign-in from a device with no history on the account is the signal most often present when a stolen credential is used.' },
        { feature: 'is_known_country', label: 'Country', value: 0, observed: 'a country this account has not signed in from', contributed: true, explanation: 'The account has no successful sign-in from this country, so either the person has travelled or someone else is using the account.' },
        { feature: 'login_velocity', label: 'Recent attempts', value: 6, observed: '6 sign-in attempts in the preceding window', contributed: true, explanation: 'More than 3 attempts in the window is the pattern of someone working through codes or passwords rather than signing in once.' },
        { feature: 'time_deviation', label: 'Time of day', value: 11.2, observed: "11.2 hours from this account's usual sign-in time", contributed: true, explanation: "A gap of more than 8.5 hours from the account's established hours means the sign-in happened at a time this person does not normally use the service." },
        { feature: 'is_known_city', label: 'City', value: 0, observed: 'a city this account has not signed in from', contributed: true, explanation: 'A new city within a familiar country is a weaker signal than a new country, and is common for someone who travels within Kenya.' },
        { feature: 'login_hour', label: 'Hour', value: 3, observed: '03:00', contributed: false, explanation: 'Recorded for context; the model judges the hour through its deviation, above.' },
      ],
    },
  ],
};

export const sessions = {
  total: 1,
  limit: 50,
  offset: 0,
  status: 'active',
  cache: { available: true },
  sessions: [
    {
      id: 's1111111-1111-1111-1111-111111111111',
      status: 'active',
      account: {
        id: 'u3333333-3333-3333-3333-333333333333',
        fullName: 'Ops Administrator', role: 'administrator',
        accountStatus: 'active', phoneNumber: '+2547****0001',
        sessionRole: 'administrator',
      },
      device: { fingerprint: 'console-abc', ip: '41.90.64.33', lastSeenIp: null },
      startedAt: '2026-11-10T16:42:11.987Z',
      lastSeenAt: null,
      expiresAt: '2026-11-17T16:42:11.987Z',
      riskScore: 12.4,
      cache: { cached: true, ttlSeconds: 604787 },
    },
  ],
};

export const locations = {
  window: '7d',
  from: '2026-11-03T17:00:00.000Z',
  to: '2026-11-10T17:00:00.000Z',
  previousFrom: '2026-10-27T17:00:00.000Z',
  points: [
    {
      id: 'l1111111-1111-1111-1111-111111111111',
      lat: -1.2921, lon: 36.8219, country: 'KE', city: 'Nairobi',
      ip: '41.90.64.33', time: '2026-11-10T16:00:00.000Z', succeeded: true,
      riskScore: 3.2, riskLevel: 'low', action: 'allow',
      account: { id: 'u1111111-1111-1111-1111-111111111111', fullName: 'Grace Wanjiku', role: 'family' },
    },
    {
      id: 'l2222222-2222-2222-2222-222222222222',
      lat: 6.5244, lon: 3.3792, country: 'NG', city: 'Lagos',
      ip: '203.0.113.7', time: '2026-11-10T16:42:11.000Z', succeeded: false,
      riskScore: 92.4, riskLevel: 'high', action: 'block',
      account: { id: 'u1111111-1111-1111-1111-111111111111', fullName: 'Grace Wanjiku', role: 'family' },
    },
  ],
  impossibleTravel: [
    {
      id: 'i1111111-1111-1111-1111-111111111111',
      time: '2026-11-10T16:42:11.000Z',
      severity: 'high',
      explanation: 'Activity from Lagos, NG came 42 minute(s) after activity from Nairobi, KE, 3828 km away; that would need travel at about 5469 km/h.',
      from: 'Nairobi, KE', to: 'Lagos, NG',
      distanceKm: 3828, elapsedMinutes: 42, requiredSpeedKmh: 5469, stage: 'login',
      points: { from: { lat: -1.2921, lon: 36.8219 }, to: { lat: 6.5244, lon: 3.3792 } },
      account: { id: 'u1111111-1111-1111-1111-111111111111', fullName: 'Grace Wanjiku', role: 'family' },
    },
  ],
};

export const accounts = {
  accounts: [
    {
      id: 'u1111111-1111-1111-1111-111111111111',
      fullName: 'Grace Wanjiku', role: 'family', accountStatus: 'frozen',
      phoneNumber: '+2547****1234', events: 24, lastEventAt: '2026-11-10T16:42:12.017Z',
    },
    {
      id: 'u2222222-2222-2222-2222-222222222222',
      fullName: 'Mary Wanjiru', role: 'caregiver', accountStatus: 'active',
      phoneNumber: '+2547****5678', events: 9, lastEventAt: '2026-11-10T16:30:00.000Z',
    },
  ],
};

export const me = {
  id: 'u3333333-3333-3333-3333-333333333333',
  fullName: 'Ops Administrator',
  phoneNumber: '+254700000001',
  email: null,
  backupEmail: null,
  role: 'administrator',
  accountStatus: 'active',
  verificationStatus: 'unverified',
};

export const modelInfo = {
  thresholds: { allowMax: 58.9, stepUpMax: 88, source: 'engine', modelLoaded: true },
  explanationCutoffs: { time_deviation: 8.5, login_velocity: 3 },
  signals: [
    { feature: 'is_known_device', label: 'Device' },
    { feature: 'is_known_country', label: 'Country' },
  ],
  layers: [],
};

export const policy = {
  policy: {
    freezeOnBlock: true,
    freezeRiskThreshold: 0,
    freezeOnSeverities: [],
    endSessionsOnFreeze: true,
    adminsCanFreezeAdmins: false,
  },
};

/** The audit trail endpoint returns the same event shape under `events`. */
export const auditTrail = { total: events.total, limit: 50, offset: 0, events: events.events };
