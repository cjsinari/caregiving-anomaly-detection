import { z } from 'zod';
import { contactToE164 } from './phone';

/*
 * Account recovery: one field, because the person using it has already lost
 * something and should not also have to remember which of two contacts they
 * registered with.
 *
 * The classification here matches the service's `classifyContact`: an "@"
 * means email, anything else is treated as a phone number. Keeping the two in
 * step matters more than usual — a contact this form accepts and the service
 * then cannot classify produces the generic "if this account exists" answer,
 * which is indistinguishable from having typed the wrong address. The person
 * would wait for a code that was never going to come.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const contactField = z.string().trim().superRefine((value, ctx) => {
  if (!value) {
    ctx.addIssue({ code: 'custom', message: 'Enter your email address or phone number' });
    return;
  }

  if (value.includes('@')) {
    if (!EMAIL.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid email address' });
    }
    return;
  }

  /*
   * A bare local number is assumed Kenyan by the service, so 0712 345 678
   * resolves and 07700 900123 does not. Saying "with its country code" is the
   * difference between a family member in the diaspora recovering their
   * account and one staring at a form that insists their own number is wrong.
   */
  if (!contactToE164(value)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Enter a valid phone number. For a number outside Kenya, include the country code, e.g. +44 7700 900123',
    });
  }
});

export const recoverySchema = z.object({ contact: contactField });

export const recoveryDefaults = () => ({ contact: '' });

/** Which channel the code will arrive on, decided by what was typed. */
export const channelFor = (contact) =>
  (String(contact || '').includes('@') ? 'email' : 'sms');

/**
 * The contact as the service wants it.
 *
 * An email is lowercased because the service matches case-insensitively and
 * sending it as typed just means the comparison happens there instead. A phone
 * number is normalised to E.164 here so that what is shown on the next screen
 * is what the code was actually bound to.
 */
export function toContact(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return contactToE164(trimmed) || trimmed;
}

/*
 * The service names the field `contact`, and so does the form, so a field-level
 * 400 lands without translation. Kept explicit anyway: the registration and
 * sign-in forms both need a map, and a reader should not have to work out
 * whether this one is missing or simply identical.
 */
export const SERVICE_FIELD_TO_FORM_FIELD = {
  contact: 'contact',
  otp: 'otp',
};
