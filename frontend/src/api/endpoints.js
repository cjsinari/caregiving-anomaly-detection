import { api } from './client';

/*
 * Every call the dashboard makes, named once.
 *
 * Components ask for `events.list({ window: '24h' })` rather than assembling a
 * path and a query string. That keeps the service's contract in one file — when
 * a parameter is renamed there is one place to change — and it keeps paths out
 * of the render tree, where a typo becomes a 404 nobody notices until a panel
 * is empty.
 */

export const auth = {
  /** Step one: ask for a login code. The answer is the same for any number. */
  requestCode: (phoneNumber) =>
    api.public.post('/auth/otp/request', { phoneNumber, purpose: 'login' }),

  /** Step two. Either returns tokens, or asks for step-up, or refuses. */
  verifyLogin: ({ phoneNumber, otp, deviceFingerprint }) =>
    api.public.post('/auth/login/verify', { phoneNumber, otp, deviceFingerprint }),

  /** Step three, when the risk engine asked for it. */
  verifyStepUp: ({ challengeId, otp, trustDevice = true, deviceLabel }) =>
    api.public.post('/auth/step-up/verify', { challengeId, otp, trustDevice, deviceLabel }),

  me: () => api.get('/auth/me'),

  /** Ends the session service-side, which drops the Redis entry immediately. */
  logout: () => api.post('/auth/logout'),
};

export const stats = {
  summary: (params) => api.get('/admin/stats/summary', params),
};

export const events = {
  list: (params) => api.get('/admin/events', params),
  timeseries: (params) => api.get('/admin/stats/timeseries', params),
  /** The same filters as the table, as a CSV file. Recorded as its own action. */
  exportCsv: (params) => api.download('/admin/events.csv', params),
};

export const anomalies = {
  list: (params) => api.get('/admin/anomalies', params),
  distribution: (params) => api.get('/admin/anomalies/distribution', params),
};

export const locations = {
  list: (params) => api.get('/admin/locations', params),
};

/** What the risk model is enforcing, so the charts can mark its thresholds. */
export const model = {
  get: () => api.get('/admin/model'),
};

export const sessions = {
  list: (params) => api.get('/admin/sessions', params),
  block: (id, reason) => api.post(`/admin/sessions/${id}/block`, { reason }),
};

export const accounts = {
  /** The account list, with each one's event count and most recent event. */
  list: () => api.get('/audit/accounts'),
  freeze: (id, reason) => api.post(`/admin/accounts/${id}/freeze`, { reason }),
  restore: (id, reason) => api.post(`/admin/accounts/${id}/restore`, { reason }),
};

export const auditTrail = {
  list: (params) => api.get('/audit', params),
};

export const policy = {
  get: () => api.get('/admin/policy'),
};
