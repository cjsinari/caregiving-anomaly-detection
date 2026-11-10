const express = require('express');
const ctrl = require('../controllers/adminController');
const { verifyToken } = require('../middleware/auth');
const { enforceApiVelocity } = require('../middleware/apiVelocity');
const { requireActiveRole } = require('../middleware/ownership');

/*
 * Administrator security actions.
 *
 * Authorization is the database check, as on the audit routes: these endpoints
 * freeze accounts and end other people's sessions, so a stale administrator
 * claim in a token must not be enough to use them, and every refusal is written
 * to the trail.
 */
const router = express.Router();

router.use(verifyToken, enforceApiVelocity);

const adminOnly = (action) =>
  requireActiveRole({ roles: ['administrator'], action, resourceType: 'account' });

router.post('/accounts/:id/freeze', adminOnly('freeze'), ctrl.freezeAccount);
router.post('/accounts/:id/restore', adminOnly('restore'), ctrl.restoreAccount);
router.post('/sessions/:id/block', adminOnly('block_session'), ctrl.blockSession);
router.get('/policy', adminOnly('read'), ctrl.getPolicy);

module.exports = router;
