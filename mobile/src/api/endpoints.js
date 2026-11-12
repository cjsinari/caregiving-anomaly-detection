import { api } from './client';

/*
 * Every call the app makes, named once.
 *
 * Screens ask for `auth.register(values)` rather than assembling a path and a
 * body. That keeps the service's contract in one file, and it keeps paths out
 * of the render tree where a typo becomes a 404 nobody notices until a form
 * silently stops working.
 *
 * Note the paths carry no version prefix. Issue #41 specifies
 * POST /v1/auth/register, but the service mounts its router at /auth
 * (auth-service/index.js). The running service wins; if a /v1 prefix is added
 * later it belongs in the base URL, not sprinkled through this file.
 */

export const auth = {
  /**
   * Create a pending account and send the first verification code.
   *
   * Returns `{ message }`, not a session -- the account does not exist in any
   * usable sense until the code is entered, which is issue #43's screen.
   */
  register: (values) => api.post('/auth/register', values),

  /** Ask for another code. Shared by registration and sign-in. */
  requestOtp: (phoneNumber, purpose) =>
    api.post('/auth/otp/request', { phoneNumber, purpose }),

  /** Finish registration. Returns tokens and trusts the device. (#43) */
  verifyRegistration: ({ phoneNumber, otp, deviceFingerprint }) =>
    api.post('/auth/register/verify', { phoneNumber, otp, deviceFingerprint }),
};
