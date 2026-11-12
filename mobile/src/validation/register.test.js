import {
  caregiverSchema, familySchema, schemaFor, toRegisterPayload, defaultValues,
} from './register';
import { toE164, isKenyanMobile, formatLocal, isValidE164 } from './phone';

/*
 * The client-side rules, tested against the cases that matter.
 *
 * These are not tests of Zod. They are tests of the two things that can go
 * wrong here without anyone noticing: the mirror drifting out of step with
 * auth-service's registerSchema, and the payload mapping sending a field the
 * service will reject or omitting one it requires.
 *
 * The messages are asserted by field, not by wording -- a reworded message is
 * not a regression, but a message that lands on the wrong field is, because
 * it appears under the wrong input or nowhere at all.
 */

const caregiver = (overrides = {}) => ({
  ...defaultValues('caregiver'),
  fullName: 'Jane Kamau',
  localNumber: '712345678',
  nationalId: '32847291',
  county: 'Nairobi',
  consent: true,
  ...overrides,
});

const family = (overrides = {}) => ({
  ...defaultValues('family'),
  fullName: 'Peter Omondi',
  localNumber: '722000111',
  county: 'Kisumu',
  careRecipientName: 'Mary Omondi',
  relationshipToRecipient: 'parent',
  consent: true,
  ...overrides,
});

/** The fields a failed parse complained about. */
const failedFields = (schema, value) => {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.join('.')).sort();
};

describe('phone helpers', () => {
  it('joins a dial code and a local number into E.164', () => {
    expect(toE164('+254', '712345678')).toBe('+254712345678');
  });

  it('drops the national leading zero people actually type', () => {
    expect(toE164('+254', '0712345678')).toBe('+254712345678');
    expect(toE164('+254', '0712 345 678')).toBe('+254712345678');
  });

  it('accepts Safaricom, Airtel and Telkom mobile prefixes', () => {
    expect(isKenyanMobile('712345678')).toBe(true);   // 7xx
    expect(isKenyanMobile('110123456')).toBe(true);   // 1xx
    expect(isKenyanMobile('0712345678')).toBe(true);  // with the zero
  });

  it('rejects a landline, which would never receive the SMS', () => {
    expect(isKenyanMobile('202345678')).toBe(false);
  });

  it('rejects a number of the wrong length', () => {
    expect(isKenyanMobile('71234567')).toBe(false);
    expect(isKenyanMobile('7123456789')).toBe(false);
  });

  it('matches the service final E.164 check', () => {
    expect(isValidE164('+254712345678')).toBe(true);
    expect(isValidE164('+0712345678')).toBe(false);   // leading zero after +
    expect(isValidE164('254712345678')).toBe(false);  // no +
  });

  it('groups digits for display without changing them', () => {
    expect(formatLocal('712345678')).toBe('712 345 678');
    expect(formatLocal('712')).toBe('712');
    expect(formatLocal('0712345678')).toBe('712 345 678');
  });
});

describe('caregiver registration', () => {
  it('accepts a complete form', () => {
    expect(caregiverSchema().safeParse(caregiver()).success).toBe(true);
  });

  it('requires the national ID', () => {
    expect(failedFields(caregiverSchema(), caregiver({ nationalId: '' })))
      .toEqual(['nationalId']);
  });

  it('accepts a seven-digit ID, which is still in circulation', () => {
    expect(caregiverSchema().safeParse(caregiver({ nationalId: '1234567' })).success).toBe(true);
  });

  it('accepts an ID typed with separators', () => {
    expect(caregiverSchema().safeParse(caregiver({ nationalId: '32 847 291' })).success).toBe(true);
  });

  it('rejects an ID with a leading zero or the wrong length', () => {
    expect(failedFields(caregiverSchema(), caregiver({ nationalId: '02847291' })))
      .toEqual(['nationalId']);
    expect(failedFields(caregiverSchema(), caregiver({ nationalId: '123456' })))
      .toEqual(['nationalId']);
  });

  it('requires a county', () => {
    expect(failedFields(caregiverSchema(), caregiver({ county: undefined })))
      .toEqual(['county']);
  });

  it('rejects a county that is not one of the 47', () => {
    expect(failedFields(caregiverSchema(), caregiver({ county: 'Atlantis' })))
      .toEqual(['county']);
  });

  it('requires consent, and an unticked box is not consent', () => {
    expect(failedFields(caregiverSchema(), caregiver({ consent: false })))
      .toEqual(['consent']);
  });

  it('puts a bad phone number on the visible input, not on a joined string', () => {
    expect(failedFields(caregiverSchema(), caregiver({ localNumber: '202345678' })))
      .toEqual(['localNumber']);
  });

  it('treats email as optional but validates one that is given', () => {
    expect(caregiverSchema().safeParse(caregiver({ email: '' })).success).toBe(true);
    expect(failedFields(caregiverSchema(), caregiver({ email: 'not-an-email' })))
      .toEqual(['email']);
  });

  it('reports every problem at once rather than one at a time', () => {
    expect(failedFields(caregiverSchema(), caregiver({
      fullName: 'J', nationalId: 'xx', county: undefined, consent: false,
    }))).toEqual(['consent', 'county', 'fullName', 'nationalId']);
  });

  /*
   * A regression guard, not a nicety.
   *
   * Expressed as an object-level superRefine, the phone rules were silently
   * skipped whenever any other field was invalid -- so a landline plus an
   * unticked consent box reported only the consent box, and the number only
   * surfaced on the next submit. The rules are field-level now; this is what
   * stops them drifting back.
   */
  it('reports a bad phone number even when other fields are also wrong', () => {
    expect(failedFields(caregiverSchema(), caregiver({
      localNumber: '202345678', county: undefined, consent: false,
    }))).toEqual(['consent', 'county', 'localNumber']);
  });
});

describe('family registration', () => {
  it('accepts a complete form in Kenya', () => {
    expect(familySchema().safeParse(family()).success).toBe(true);
  });

  it('requires a county when the country is Kenya', () => {
    expect(failedFields(familySchema(), family({ county: undefined })))
      .toEqual(['county']);
  });

  it('does not require a county for someone in the diaspora', () => {
    const abroad = family({ countryCode: 'GB', county: undefined,
      dialCode: '+44', localNumber: '7700900123' });
    expect(familySchema('+44', 'GB').safeParse(abroad).success).toBe(true);
  });

  it('lets a diaspora family member keep a Kenyan number', () => {
    const abroad = family({ countryCode: 'GB', county: undefined });
    expect(familySchema('+254', 'GB').safeParse(abroad).success).toBe(true);
  });

  it('still applies the Kenyan mobile rule when the dial code is +254', () => {
    const abroad = family({ countryCode: 'GB', county: undefined, localNumber: '202345678' });
    expect(failedFields(familySchema('+254', 'GB'), abroad)).toEqual(['localNumber']);
  });

  it('requires the person being followed and the relationship', () => {
    expect(failedFields(familySchema(), family({
      careRecipientName: '', relationshipToRecipient: undefined,
    }))).toEqual(['careRecipientName', 'relationshipToRecipient']);
  });

  it('rejects a relationship outside the vocabulary the service accepts', () => {
    expect(failedFields(familySchema(), family({ relationshipToRecipient: 'cousin' })))
      .toEqual(['relationshipToRecipient']);
  });

  it('reports a missing county alongside every other problem, not after them', () => {
    expect(failedFields(familySchema(), family({
      county: undefined, careRecipientName: '', consent: false,
    }))).toEqual(['careRecipientName', 'consent', 'county']);
  });
});

describe('schemaFor', () => {
  it('builds the caregiver schema, which is always +254', () => {
    expect(schemaFor({ role: 'caregiver' }).safeParse(caregiver()).success).toBe(true);
  });

  it('applies the Kenyan mobile rule only while the dial code is +254', () => {
    const value = family({ localNumber: '7700900123', dialCode: '+44', countryCode: 'GB',
      county: undefined });
    expect(schemaFor({ role: 'family', dialCode: '+44', countryCode: 'GB' })
      .safeParse(value).success).toBe(true);
    // The same digits under +254 are not a Kenyan mobile.
    expect(failedFields(schemaFor({ role: 'family', dialCode: '+254', countryCode: 'GB' }),
      { ...value, dialCode: '+254' })).toEqual(['localNumber']);
  });

  it('requires a county at home and not abroad', () => {
    const value = family({ county: undefined });
    expect(failedFields(schemaFor({ role: 'family', countryCode: 'KE' }), value))
      .toEqual(['county']);
    expect(schemaFor({ role: 'family', countryCode: 'GB' })
      .safeParse({ ...value, countryCode: 'GB' }).success).toBe(true);
  });
});

describe('toRegisterPayload', () => {
  it('sends a caregiver exactly what the service asks for', () => {
    expect(toRegisterPayload(caregiver({ email: 'jane@example.com' }))).toEqual({
      phoneNumber: '+254712345678',
      fullName: 'Jane Kamau',
      consent: true,
      email: 'jane@example.com',
      role: 'caregiver',
      nationalId: '32847291',
      county: 'Nairobi',
      countryCode: 'KE',
    });
  });

  it('omits an untouched email rather than sending an empty string', () => {
    // The service validates the shape of a string that is present, so ''
    // would be a validation failure rather than an absent optional.
    expect(toRegisterPayload(caregiver({ email: '' }))).not.toHaveProperty('email');
    expect(toRegisterPayload(caregiver({ email: '   ' }))).not.toHaveProperty('email');
  });

  it('strips separators from the national ID so the hash is stable', () => {
    expect(toRegisterPayload(caregiver({ nationalId: '32-847 291' })).nationalId)
      .toBe('32847291');
  });

  it('never sends a family member a national ID field', () => {
    expect(toRegisterPayload(family())).not.toHaveProperty('nationalId');
  });

  it('drops a stale county when the family member moved abroad', () => {
    // Pick Nairobi, change your mind, switch the country to the UK: the county
    // must not travel with the request.
    const payload = toRegisterPayload(family({ countryCode: 'GB', county: 'Nairobi' }));
    expect(payload).not.toHaveProperty('county');
    expect(payload.countryCode).toBe('GB');
  });

  it('trims the names it sends', () => {
    const payload = toRegisterPayload(family({
      fullName: '  Peter Omondi  ', careRecipientName: '  Mary Omondi ',
    }));
    expect(payload.fullName).toBe('Peter Omondi');
    expect(payload.careRecipientName).toBe('Mary Omondi');
  });

  it('joins a diaspora number with its own dial code', () => {
    const payload = toRegisterPayload(family({
      countryCode: 'GB', county: undefined, dialCode: '+44', localNumber: '07700900123',
    }));
    expect(payload.phoneNumber).toBe('+447700900123');
  });

  it('always asserts consent, since the schema refuses anything else', () => {
    expect(toRegisterPayload(caregiver()).consent).toBe(true);
  });
});
