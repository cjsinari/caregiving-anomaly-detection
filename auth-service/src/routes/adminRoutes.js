const express = require('express');
const ctrl = require('../controllers/adminController');
const data = require('../controllers/adminDataController');
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

module.exports = router;
