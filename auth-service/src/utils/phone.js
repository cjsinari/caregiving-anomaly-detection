/**
 * Normalise a Kenyan or international phone number to E.164 format
 * @param {string} phone
 * @returns {string} E.164 formatted number
 */
function normalisePhone(phone) {
  // Strip spaces, hyphens, parentheses
  let cleaned = phone.replace(/[\s\-()]/g, '');

  // Already in E.164
  if (cleaned.startsWith('+')) return cleaned;

  // Kenyan number starting with 254
  if (cleaned.startsWith('254') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  // Kenyan number starting with 0
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `+254${cleaned.slice(1)}`;
  }

  // International number without +
  if (cleaned.length > 10) {
    return `+${cleaned}`;
  }

  throw new Error(`Invalid phone number format: ${phone}`);
}

/**
 * Normalise and then confirm the result really is a dialable E.164 number.
 * normalisePhone accepts anything it can reshape; this is the check that keeps a
 * reshaped-but-impossible number (too short, leading zero) out of the database.
 * Throws on unusable input.
 */
function toE164(input) {
  const phone = normalisePhone(input);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Invalid phone number');
  return phone;
}

module.exports = { normalisePhone, toE164 };