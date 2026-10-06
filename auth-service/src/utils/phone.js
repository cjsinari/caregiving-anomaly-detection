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

module.exports = { normalisePhone };