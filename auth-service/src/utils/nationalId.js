const crypto = require('crypto');

/*
 * Kenyan national ID handling.
 *
 * The number itself is never stored. What goes in the database is a keyed hash
 * — enough to tell two caregivers apart and to catch the same identity being
 * registered twice — plus the last four digits, which is what support asks for
 * on a call. See sql/mobile_registration.sql for why.
 */

/**
 * Strip the punctuation people type and leave the digits.
 *
 * IDs get written "12345678", "12 345 678" and "12-345-678" by the same person
 * on different days. Normalising before hashing is what makes the uniqueness
 * index mean anything: without it the three spellings are three caregivers.
 */
function normaliseNationalId(input) {
  return String(input || '').replace(/[\s\-/]/g, '');
}

/**
 * True for a plausible Kenyan national ID.
 *
 * Seven or eight digits. Older IDs issued before the numbering ran past seven
 * digits are still in active circulation and still valid, so a strict
 * eight-digit rule would turn away the oldest caregivers on the platform.
 * A leading zero is not a real ID.
 */
function isValidNationalId(input) {
  return /^[1-9]\d{6,7}$/.test(normaliseNationalId(input));
}

/**
 * HMAC-SHA256 under NATIONAL_ID_SECRET.
 *
 * Keyed, not plain: the whole space of 7-8 digit numbers is about 100 million
 * values, which an unkeyed SHA-256 enumerates in seconds. The key is what makes
 * the stored digest useless to someone holding only the table.
 *
 * Throws when the secret is missing rather than falling back to an unkeyed
 * hash. A silent fallback here would produce a column that looks protected and
 * is not, and nobody would find out until it mattered.
 */
function hashNationalId(input) {
  const secret = process.env.NATIONAL_ID_SECRET;
  if (!secret) throw new Error('NATIONAL_ID_SECRET is not configured');
  return crypto.createHmac('sha256', secret).update(normaliseNationalId(input)).digest('hex');
}

/** The last four digits, for support to confirm an identity out loud. */
function nationalIdLast4(input) {
  return normaliseNationalId(input).slice(-4);
}

module.exports = { normaliseNationalId, isValidNationalId, hashNationalId, nationalIdLast4 };
