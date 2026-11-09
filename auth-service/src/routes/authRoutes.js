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