const express = require('express');
const ctrl = require('../controllers/auditController');
const { verifyToken } = require('../middleware/auth');
const { enforceApiVelocity } = require('../middleware/apiVelocity');
const { requireActiveRole } = require('../middleware/ownership');

/*
 * Audit trail routes. Administrators only, both of them.
 *
 * The role is checked against the database rather than the token's claim, by
 * requireActiveRole: a token issued before an administrator account was
 * suspended still carries the administrator claim. It is also what writes the
 * refusal to the trail, which is why there is no cheaper token-only guard in
 * front of it — an attempt on the audit trail by an account that has no business
 * there is exactly the kind of thing the trail should contain.
 */
const router = express.Router();

router.use(verifyToken, enforceApiVelocity);

const adminOnly = (action) =>
  requireActiveRole({ roles: ['administrator'], action, resourceType: 'audit_trail' });

router.get('/', adminOnly('read'), ctrl.listAuditTrail);
router.get('/accounts', adminOnly('list'), ctrl.listAccounts);

module.exports = router;
