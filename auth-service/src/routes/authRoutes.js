const express = require('express');
const ctrl = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');
const { enforceApiVelocity } = require('../middleware/apiVelocity');

const router = express.Router();

router.post('/register', ctrl.register);
router.post('/register/verify', ctrl.verifyRegistration);
router.post('/otp/request', ctrl.requestOtp);
router.post('/login/verify', ctrl.verifyLogin);
router.post('/step-up/verify', ctrl.verifyStepUp);
// Recovery is unauthenticated by definition: whoever needs it cannot sign in.
// Both steps sit behind the per-IP authLimiter in index.js, and the request
// step additionally behind the per-account OTP budget in utils/otp.js.
router.post('/recovery/request', ctrl.requestRecovery);
router.post('/recovery/verify', ctrl.verifyRecovery);
router.post('/refresh', ctrl.refresh);
// Every authenticated route is also subject to per-session API velocity.
// Logout is exempt so a throttled client can always end its own session.
const authed = [verifyToken, enforceApiVelocity];

router.post('/logout', verifyToken, ctrl.logout);
router.get('/me', authed, ctrl.me);
router.get('/devices', authed, ctrl.listDevices);
router.delete('/devices/:id', authed, ctrl.revokeDevice);
router.get('/notifications', authed, ctrl.listNotifications);
router.post('/notifications/read', authed, ctrl.readNotifications);

module.exports = router;