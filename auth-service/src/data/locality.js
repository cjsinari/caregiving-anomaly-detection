/*
 * The closed vocabularies registration validates against.
 *
 * These are duplicated in mobile/src/data/locality.js, which is the copy the
 * dropdowns render from. That duplication is deliberate and the direction
 * matters: this file is the authority, the mobile copy is a convenience. The
 * app cannot be trusted to constrain what the service stores — a request does
 * not have to come from the app — so the service checks the value itself and
 * the two lists are kept in step by hand. Serving the list from an endpoint
 * instead would remove the duplication, at the cost of a network round trip
 * before a registration form can render its first dropdown.
 */

/** The 47 counties of Kenya, as named in the Constitution's First Schedule. */
const KENYA_COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa',
  'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi',
  'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu',
  'Machakos', 'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa',
  "Murang'a", 'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua',
  'Nyeri', 'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi',
  'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot',
];

/**
 * Countries a family member may be registering from.
 *
 * Not every country in the world: the ones with a Kenyan community large
 * enough that someone is plausibly following a parent's care from there, plus
 * Kenya itself. A short, ordered list is a usable dropdown; 195 entries is a
 * search problem. Adding a country here is a one-line change when one is asked
 * for, and the mobile copy has to be updated with it.
 */
const COUNTRIES = [
  { code: 'KE', name: 'Kenya', dialCode: '+254' },
  { code: 'US', name: 'United States', dialCode: '+1' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44' },
  { code: 'CA', name: 'Canada', dialCode: '+1' },
  { code: 'AU', name: 'Australia', dialCode: '+61' },
  { code: 'DE', name: 'Germany', dialCode: '+49' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971' },
  { code: 'QA', name: 'Qatar', dialCode: '+974' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966' },
  { code: 'OM', name: 'Oman', dialCode: '+968' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27' },
  { code: 'UG', name: 'Uganda', dialCode: '+256' },
  { code: 'TZ', name: 'Tanzania', dialCode: '+255' },
  { code: 'RW', name: 'Rwanda', dialCode: '+250' },
  { code: 'IE', name: 'Ireland', dialCode: '+353' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31' },
  { code: 'SE', name: 'Sweden', dialCode: '+46' },
  { code: 'NO', name: 'Norway', dialCode: '+47' },
  { code: 'DK', name: 'Denmark', dialCode: '+45' },
  { code: 'FI', name: 'Finland', dialCode: '+358' },
  { code: 'FR', name: 'France', dialCode: '+33' },
  { code: 'BE', name: 'Belgium', dialCode: '+32' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41' },
  { code: 'IT', name: 'Italy', dialCode: '+39' },
  { code: 'ES', name: 'Spain', dialCode: '+34' },
  { code: 'PT', name: 'Portugal', dialCode: '+351' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64' },
  { code: 'IN', name: 'India', dialCode: '+91' },
  { code: 'CN', name: 'China', dialCode: '+86' },
  { code: 'JP', name: 'Japan', dialCode: '+81' },
  { code: 'OTHER', name: 'Other', dialCode: '' },
];

/**
 * How a family member is related to the person they are following.
 *
 * Stored as a slug, shown as a label. The slug is what the family screens in
 * M7 branch on, so it has to survive the label being reworded.
 */
const RELATIONSHIPS = [
  { value: 'child', label: 'Son / Daughter' },
  { value: 'spouse', label: 'Husband / Wife' },
  { value: 'parent', label: 'Father / Mother' },
  { value: 'sibling', label: 'Brother / Sister' },
  { value: 'grandchild', label: 'Grandson / Granddaughter' },
  { value: 'niece_nephew', label: 'Niece / Nephew' },
  { value: 'in_law', label: 'In-law' },
  { value: 'guardian', label: 'Legal guardian' },
  { value: 'other', label: 'Other' },
];

const COUNTRY_CODES = COUNTRIES.map((c) => c.code);
const RELATIONSHIP_VALUES = RELATIONSHIPS.map((r) => r.value);

module.exports = {
  KENYA_COUNTIES, COUNTRIES, RELATIONSHIPS, COUNTRY_CODES, RELATIONSHIP_VALUES,
};
