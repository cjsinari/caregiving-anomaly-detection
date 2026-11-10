const express = require('express');
const ctrl = require('../controllers/profileController');
const { verifyToken } = require('../middleware/auth');
const { enforceApiVelocity } = require('../middleware/apiVelocity');
const { requireProfileAccess, requireActiveRole } = require('../middleware/ownership');

/*
 * Care profile routes.
 *
 * Every route carries its own authorization middleware, and the action named
 * there is what gets written to the audit trail. The pattern is deliberate: a
 * route added without one of these guards does not quietly inherit someone
 * else's permissions, it simply has no handler-side check to fall back on,
 * because the handlers assume they were authorized.
 */
const router = express.Router();

router.use(verifyToken, enforceApiVelocity);

// Collection routes have no resource to own yet, so they check role and account
// status instead, and the database scopes the listing.
router.post('/', requireActiveRole({ roles: ['family'], action: 'create' }), ctrl.createProfile);
router.get('/', requireActiveRole({ roles: ['family', 'caregiver'], action: 'list' }), ctrl.listProfiles);

router.get('/:id', requireProfileAccess('read'), ctrl.getProfile);
router.patch('/:id', requireProfileAccess('write'), ctrl.updateProfile);
router.delete('/:id', requireProfileAccess('delete'), ctrl.deleteProfile);

// The care team: only the family member who owns the profile may see or change
// who has access to it.
router.get('/:id/assignments', requireProfileAccess('manage'), ctrl.listAssignments);
router.post('/:id/assignments', requireProfileAccess('manage'), ctrl.assignCaregiver);
router.delete('/:id/assignments/:assignmentId', requireProfileAccess('manage'), ctrl.endAssignment);

module.exports = router;
