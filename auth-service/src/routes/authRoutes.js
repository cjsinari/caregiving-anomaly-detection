const express = require('express');
const ctrl = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/register', ctrl.register);
router.post('/register/verify', ctrl.verifyRegistration);
router.post('/otp/request', ctrl.requestOtp);
router.post('/login/verify', ctrl.verifyLogin);
router.post('/step-up/verify', ctrl.verifyStepUp);
router.post('/refresh', ctrl.refresh);
router.post('/logout', verifyToken, ctrl.logout);
router.get('/me', verifyToken, ctrl.me);
router.get('/devices', verifyToken, ctrl.listDevices);
router.delete('/devices/:id', verifyToken, ctrl.revokeDevice);

module.exports = router;