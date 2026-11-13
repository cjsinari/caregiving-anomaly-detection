import { api } from './client';

/*
 * Every call the app makes, named once.
 *
 * Screens ask for `auth.register(values)` rather than assembling a path and a
 * body. That keeps the contract of the service in one file, and it keeps paths
 * out of the render tree where a typo becomes a 404 nobody notices until a
 * form silently stops working.
 *
 * Note the paths carry no version prefix. Issues #41 and #42 specify
 * POST /v1/auth/register and POST /v1/auth/login, but the service mounts its
 * router at /auth (auth-service/index.js). The running service wins; if a /v1
 * prefix is added later it belongs in the base URL, not sprinkled through this
 * file.
 *
 * -- There is no /auth/login --
 *
 * Sign-in is strictly OTP, so it is two calls rather than one. `requestOtp`
 * sends the code and `verifyLogin` exchanges it for a session. A single
 * endpoint taking a phone number and a password would need a password, and the
 * service has none by design.
 */

export const auth = {
  /**
   * Create a pending account and send the first verification code.
   *
   * Returns `{ message }`, not a session -- the account does not exist in any
   * usable sense until the code is entered.
   */
  register: (values) => api.post('/auth/register', values),

  /**
   * Ask for a code. Shared by registration and sign-in.
   *
   * Always answers 200 with the same sentence whether or not the number is
   * registered, so the response cannot be used to find out who has an account.
   * That is why the login screen moves to the code entry regardless.
   */
  requestOtp: (phoneNumber, purpose) =>
    api.post('/auth/otp/request', { phoneNumber, purpose }),

  /** Finish registration. Returns a session and trusts the device. */
  verifyRegistration: ({ phoneNumber, otp, deviceFingerprint }) =>
    api.post('/auth/register/verify', { phoneNumber, otp, deviceFingerprint }),

  /**
   * Finish signing in.
   *
   * Returns either a session, or `{ status: 'step_up_required', challengeId }`
   * when the risk engine is not satisfied with the attempt -- an unrecognised
   * device, a sign-in from an implausible place. The second code goes through
   * `verifyStepUp`, which is why the screen has to read `status` before it
   * assumes it has tokens.
   */
  verifyLogin: ({ phoneNumber, otp, deviceFingerprint }) =>
    api.post('/auth/login/verify', { phoneNumber, otp, deviceFingerprint }),

  /**
   * Start account recovery: send a code to a contact already on the account.
   *
   * `contact` is an email address or a phone number — whichever the person
   * still has. Always answers 200 with the same sentence, so neither this call
   * nor its timing says whether an account exists. The `channel` it returns is
   * derived from what was typed, not from what was found, so it is safe to
   * show and is what tells the next screen where to say the code went.
   */
  requestRecovery: (contact) => api.post('/auth/recovery/request', { contact }),

  /**
   * Finish recovery: prove the contact and get the account back.
   *
   * Returns a session like a sign-in does. There is no step-up, because the
   * code just answered went to a different channel from the one being
   * recovered and so already is the second factor.
   */
  verifyRecovery: ({ contact, otp, deviceFingerprint }) =>
    api.post('/auth/recovery/verify', { contact, otp, deviceFingerprint }),

  /** Answer a step-up challenge. Trusting the device makes it a one-off. */
  verifyStepUp: ({ challengeId, otp, deviceFingerprint, trustDevice = true, deviceLabel }) =>
    api.post('/auth/step-up/verify', {
      challengeId, otp, deviceFingerprint, trustDevice, deviceLabel,
    }),

  /** Who the current session belongs to. The call session restore is proved by. */
  me: () => api.authed.get('/auth/me'),

  /**
   * End the session on the service, not just on the phone.
   *
   * Deliberately an authenticated call: the service revokes the session the
   * access token names, which is what makes the refresh token useless to
   * anyone who kept a copy.
   */
  logout: () => api.authed.post('/auth/logout'),
};
