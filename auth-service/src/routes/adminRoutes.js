const express = require('express');
const ctrl = require('../controllers/adminController');
const data = require('../controllers/adminDataController');
const analytics = require('../controllers/adminAnalyticsController');
const { verifyToken } = require('../middleware/auth');
const { enforceApiVelocity } = require('../middleware/apiVelocity');
const { requireActiveRole } = require('../middleware/ownership');

/*
 * Administrator security actions, and the dashboard's read-only views.
 *
 * Authorization is the database check, as on the audit routes: these endpoints
 * freeze accounts and end other people's sessions, so a stale administrator
 * claim in a token must not be enough to use them, and every refusal is written
 * to the trail. The read endpoints go through exactly the same guard — the
 * service's entire security history is behind them, and a suspended
 * administrator's unexpired token must not open it.
 *
 * Every route names the action it is authorizing, and that name is what appears
 * in the audit trail when the guard refuses. There is no router-level shortcut
 * that would let a route be added without one.
 */
const router = express.Router();

router.use(verifyToken, enforceApiVelocity);

const adminOnly = (action, resourceType = 'account') =>
  requireActiveRole({ roles: ['administrator'], action, resourceType });

// ── Actions ──
router.post('/accounts/:id/freeze', adminOnly('freeze'), ctrl.freezeAccount);
router.post('/accounts/:id/restore', adminOnly('restore'), ctrl.restoreAccount);
router.post('/sessions/:id/block', adminOnly('block_session'), ctrl.blockSession);
router.get('/policy', adminOnly('read'), ctrl.getPolicy);

// ── Dashboard reads ──
// resourceType is what the refusal is recorded against, so a non-administrator
// probing the event feed is distinguishable in the trail from one probing the
// session list. 'audit_trail' for the event feed because that is the table it
// reads, and an attempt on it should look the same whichever endpoint was used.
router.get('/events', adminOnly('read', 'audit_trail'), data.listEvents);
router.get('/anomalies', adminOnly('read', 'anomaly'), data.listAnomalies);
router.get('/stats/summary', adminOnly('read', 'security_stats'), data.summary);
router.get('/sessions', adminOnly('list', 'session'), data.listSessions);

// ── Dashboard charts ──
// More specific paths before the listings they look like: Express 5 matches in
// order, and '/anomalies/distribution' must not be swallowed by a future
// '/anomalies/:id'.
router.get('/anomalies/distribution', adminOnly('read', 'anomaly'), analytics.distribution);
router.get('/stats/timeseries', adminOnly('read', 'security_stats'), analytics.timeseries);
router.get('/locations', adminOnly('read', 'security_stats'), analytics.locations);
router.get('/model', adminOnly('read', 'security_stats'), analytics.model);

// Taking a copy of the security history out of the system is recorded as its
// own action, with its own verb, rather than as another read.
router.get('/events.csv', adminOnly('export', 'audit_trail'), analytics.exportEvents);

// The live feed. One long-lived request, so it is authorized exactly like the
// rest and counts once against the rate limit.
router.get('/stream', adminOnly('read', 'security_stream'), analytics.liveStream);

module.exports = router;
