import { z } from 'zod';
import { phoneField, otpField, toE164 } from './phone';

/*
 * The sign-in form's rules.
 *
 * Much smaller than registration, because sign-in asks for one thing: the
 * number the account was registered with. There is no password to validate --
 * the service authenticates by SMS code only -- so the form's whole job is to
 * make sure the code is sent to a number that could receive it.
 *
 * -- Why sign-in needs a dial code at all --
 *
 * A family member in the diaspora registered with their own number, which is
 * not +254. If the sign-in screen hard-coded Kenya they could create an
 * account and then never get back into it. The picker defaults to +254,
 * because most people signing in are in Kenya, and moves out of the way for
 * the ones who are not.
 */

export const loginSchema = (dialCode = '+254') => z.object({
  dialCode: z.string().min(2),
  localNumber: phoneField(dialCode),
});

/** The six-digit code, on its own screen. */
export const verifySchema = z.object({
  otp: otpField,
});

/** What the service is sent to start a sign-in. */
export function toPhoneNumber(values) {
  return toE164(values.dialCode, values.localNumber);
}

export const loginDefaults = () => ({ dialCode: '+254', localNumber: '' });

export const verifyDefaults = () => ({ otp: '' });

/*
 * Where the service puts a field, and where the form keeps it.
 *
 * As in registration: the service names `phoneNumber`, and the form has no
 * such input -- it has a dial code and a local part. An error with nowhere to
 * land is an error nobody sees.
 */
export const SERVICE_FIELD_TO_FORM_FIELD = {
  phoneNumber: 'localNumber',
  otp: 'otp',
};
