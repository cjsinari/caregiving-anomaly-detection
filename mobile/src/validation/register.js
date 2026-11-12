import { z } from 'zod';
import { KENYA_COUNTIES, COUNTRY_CODES, RELATIONSHIP_VALUES } from '../data/locality';
import { toE164, isValidE164, isKenyanMobile, cleanDigits } from './phone';

/*
 * The registration form's rules, mirroring registerSchema in
 * auth-service/src/controllers/authController.js.
 *
 * Mirroring, not duplicating for its own sake: this copy exists so that a
 * mistyped national ID is caught on the phone instead of after a round trip
 * over a cell connection, and so the error lands under the field that caused
 * it. The service's copy is the one that decides -- it revalidates everything,
 * and it is the only one that can, since a request need not come from here.
 *
 * Where the two differ, they differ on purpose and the comment says why. There
 * are two such places: the phone number, which the app splits into a dial code
 * and a local part the service never sees apart, and the Kenyan-mobile check,
 * which the service cannot make because a family member abroad has a foreign
 * number.
 */

const fullName = z.string()
  .trim()
  .min(2, 'Enter your full name')
  .max(100, 'That name is too long');

/*
 * Email is optional on the service and optional here.
 *
 * The mockups show the field with no "optional" marker, which reads as
 * required. The screen adds that marker rather than making the field required:
 * a caregiver without an email address is a real person this platform is for,
 * and the account is reachable by SMS regardless.
 */
const email = z.union([
  z.literal(''),
  z.string().trim().email('Enter a valid email address').max(255, 'That email address is too long'),
]).optional();

const consent = z.literal(true, {
  error: 'You need to agree before we can create your account',
});

/*
 * The phone number, as the form holds it: a dial code and a local part.
 *
 * ── Why this takes the dial code as an argument ──
 *
 * The obvious shape is an object-level `superRefine` that reads both halves.
 * It is also wrong, and quietly: Zod skips a schema-level refinement whenever
 * any *field* in the object failed. So a form with a landline number and an
 * unticked consent box would report only the consent box. The person ticks it,
 * submits again, and only then finds out about the number -- errors revealed
 * one round trip at a time, on the one field where a wrong value sends the
 * verification code to a stranger.
 *
 * Building the field from the current dial code instead keeps the whole check
 * at field level, where it runs no matter what else on the form is wrong. The
 * schema is rebuilt as the dial code changes, which is cheap and is what the
 * resolver already does per render.
 */
function phoneField(dialCode) {
  return z.string().superRefine((value, ctx) => {
    const local = cleanDigits(value);
    if (!local) {
      ctx.addIssue({ code: 'custom', message: 'Enter your phone number' });
      return;
    }
    // A +254 number has to be a mobile: a landline passes every generic check
    // and then never receives the SMS the entire flow depends on.
    if (dialCode === '+254' && !isKenyanMobile(local)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a Kenyan mobile number, e.g. 0712 345 678' });
      return;
    }
    if (!isValidE164(toE164(dialCode, local))) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
    }
  });
}

/*
 * The county field, which is required of a family member in Kenya and
 * meaningless for one abroad.
 *
 * Parameterised for the same reason as the phone: expressed as an
 * object-level rule it would vanish the moment any other field was invalid.
 */
function countyField(required, message) {
  const base = z.enum(KENYA_COUNTIES, { error: message });
  return required ? base : base.optional();
}

/*
 * A caregiver: vetted, in Kenya, owes a national ID and a county.
 *
 * The ID rule is the service's rule -- 7 or 8 digits, no leading zero. Older
 * seven-digit IDs are still in circulation and still valid, so an
 * eight-digit-only check would turn away the oldest caregivers on the platform.
 */
const caregiverFields = {
  role: z.literal('caregiver'),
  fullName,
  dialCode: z.literal('+254'),
  // superRefine rather than .min().refine(): chaining the two emits two issues
  // for an empty field, and a field that reports the same problem twice is a
  // field whose second message is waiting to surface somewhere unexpected.
  nationalId: z.string().trim().superRefine((value, ctx) => {
    if (!value) {
      ctx.addIssue({ code: 'custom', message: 'Enter your national ID number' });
      return;
    }
    if (!/^[1-9]\d{6,7}$/.test(value.replace(/[\s\-/]/g, ''))) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 7 or 8 digit national ID number' });
    }
  }),
  email,
  consent,
};

/*
 * A family member: not vetted, possibly abroad, owes a country and the person
 * they are following. No national ID -- the platform has no use for a family
 * member's government identifier, so it does not ask for one.
 */
const familyFields = {
  role: z.literal('family'),
  fullName,
  dialCode: z.string().min(2),
  email,
  countryCode: z.enum(COUNTRY_CODES, { error: 'Select your country of residence' }),
  careRecipientName: z.string()
    .trim()
    .min(2, 'Enter the name of the person you are following')
    .max(100, 'That name is too long'),
  relationshipToRecipient: z.enum(RELATIONSHIP_VALUES, { error: 'Select your relationship to them' }),
  consent,
};

export const caregiverSchema = (dialCode = '+254') => z.object({
  ...caregiverFields,
  localNumber: phoneField(dialCode),
  county: countyField(true, 'Select the county you work in'),
});

export const familySchema = (dialCode = '+254', countryCode = 'KE') => z.object({
  ...familyFields,
  localNumber: phoneField(dialCode),
  county: countyField(countryCode === 'KE', 'Select the county you live in'),
});

/**
 * The schema for the form as it currently stands.
 *
 * Takes the dial code and country because the rules that depend on them are
 * built into the fields rather than layered on top of the object -- see
 * phoneField. The resolver rebuilds this per render, so changing either one
 * revalidates against the right rules immediately.
 */
export const schemaFor = ({ role, dialCode = '+254', countryCode = 'KE' }) =>
  (role === 'caregiver' ? caregiverSchema(dialCode) : familySchema(dialCode, countryCode));

/*
 * The form's values, as the service wants them.
 *
 * The form holds a dial code and a local number; the service takes one string.
 * The form holds an empty string for an untouched optional email; the service
 * wants the key absent, since its schema validates the shape of a string that
 * is present. Role-specific fields are picked explicitly rather than spread,
 * so a field belonging to the other role cannot ride along in the body.
 */
export function toRegisterPayload(values) {
  const trimmedEmail = (values.email || '').trim();
  const common = {
    phoneNumber: toE164(values.dialCode, values.localNumber),
    fullName: values.fullName.trim(),
    consent: true,
    ...(trimmedEmail ? { email: trimmedEmail } : {}),
  };

  if (values.role === 'caregiver') {
    return {
      ...common,
      role: 'caregiver',
      nationalId: values.nationalId.replace(/[\s\-/]/g, ''),
      county: values.county,
      countryCode: 'KE',
    };
  }

  return {
    ...common,
    role: 'family',
    countryCode: values.countryCode,
    // A county outside Kenya is not a county. Dropping it here keeps a stale
    // selection from travelling with the request when someone picks Nairobi,
    // changes their mind and switches the country to the United Kingdom.
    ...(values.countryCode === 'KE' && values.county ? { county: values.county } : {}),
    careRecipientName: values.careRecipientName.trim(),
    relationshipToRecipient: values.relationshipToRecipient,
  };
}

/** The empty form, per role. */
export function defaultValues(role) {
  const base = { role, fullName: '', localNumber: '', email: '', consent: false };
  return role === 'caregiver'
    ? { ...base, dialCode: '+254', nationalId: '', county: undefined }
    : {
        ...base,
        dialCode: '+254',
        countryCode: 'KE',
        county: undefined,
        careRecipientName: '',
        relationshipToRecipient: undefined,
      };
}

/*
 * Where the service puts a field, and where the form keeps it.
 *
 * The service answers a 400 with [{ field, message }] naming its own fields.
 * Most line up; phoneNumber does not, because the form has no such input -- it
 * has a dial code and a local number, and an error with nowhere to land is an
 * error nobody sees.
 */
export const SERVICE_FIELD_TO_FORM_FIELD = {
  phoneNumber: 'localNumber',
  fullName: 'fullName',
  email: 'email',
  backupEmail: 'email',
  nationalId: 'nationalId',
  county: 'county',
  countryCode: 'countryCode',
  careRecipientName: 'careRecipientName',
  relationshipToRecipient: 'relationshipToRecipient',
  consent: 'consent',
};
