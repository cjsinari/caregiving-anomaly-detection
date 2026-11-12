/*
 * Phone normalisation, mirroring auth-service/src/utils/phone.js.
 *
 * The service normalises whatever it is sent, so this is not what makes the
 * number correct -- it is what lets the form say "that is not a phone number"
 * before spending a round trip to be told so. The two implementations have to
 * agree, or the app rejects numbers the service would have taken.
 *
 * The app's input is split into a dial-code chip and a local-number field,
 * which the service knows nothing about: it receives one joined string.
 */

/** Strip the spaces, hyphens and brackets people type into phone fields. */
export function cleanDigits(input) {
  return String(input || '').replace(/[\s\-()]/g, '');
}

/**
 * Join the dial code and the local part into one E.164 string.
 *
 * A local part is allowed to keep its national leading zero -- "0712 345 678"
 * is how every Kenyan writes their own number, and dropping it here rather
 * than refusing it is the difference between a form that works and a form
 * that is technically right.
 */
export function toE164(dialCode, localNumber) {
  const local = cleanDigits(localNumber).replace(/^0+/, '');
  const code = cleanDigits(dialCode);
  return `${code.startsWith('+') ? code : `+${code}`}${local}`;
}

/** The service's final check, applied here so the form can fail first. */
export function isValidE164(value) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/**
 * A Kenyan mobile number, which is the only kind a caregiver can have.
 *
 * Safaricom, Airtel and Telkom mobile prefixes all sit in 7xx and 1xx after
 * the country code, so nine digits beginning 7 or 1. A landline would pass
 * isValidE164 and then never receive the SMS the whole flow depends on, so it
 * is worth catching here rather than at the OTP step.
 */
export function isKenyanMobile(localNumber) {
  return /^[71]\d{8}$/.test(cleanDigits(localNumber).replace(/^0+/, ''));
}

/** "712345678" -> "712 345 678", for display while typing. */
export function formatLocal(localNumber) {
  const d = cleanDigits(localNumber).replace(/^0+/, '').slice(0, 12);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}
