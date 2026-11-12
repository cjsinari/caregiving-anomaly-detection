/*
 * Regenerate mobile/src/data/locality.js from the service's copy.
 *
 * The service is the authority on what counties, countries and relationships
 * are acceptable -- it revalidates every value on arrival, because a request
 * does not have to come from this app. The app needs the same lists only so a
 * dropdown can render without a network round trip first.
 *
 * Keeping the app's copy generated rather than hand-maintained means the two
 * cannot quietly disagree. A county added to the service and forgotten here
 * would be a county a caregiver can never pick; one added here and forgotten
 * there would be a county the service rejects after the form said it was fine.
 *
 *   node scripts/sync-locality.js          write the file
 *   node scripts/sync-locality.js --check  fail if it is out of date (CI, #47)
 */

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', '..', 'auth-service', 'src', 'data', 'locality.js');
const TARGET = path.join(__dirname, '..', 'src', 'data', 'locality.js');

const { KENYA_COUNTIES, COUNTRIES, RELATIONSHIPS } = require(SOURCE);

/** JSON is a valid JS literal, and JSON.stringify quotes apostrophes correctly. */
const literal = (value) => JSON.stringify(value, null, 2);

const output = `/*
 * The dropdown contents for registration.
 *
 * GENERATED from auth-service/src/data/locality.js -- do not edit by hand.
 * Regenerate with: npm run sync:locality
 *
 * The service validates every one of these values again on arrival, because a
 * request does not have to come from this app. This copy exists so a dropdown
 * can render without a network round trip first; the service remains the
 * authority on what is acceptable.
 */

/** The 47 counties of Kenya, as named in the Constitution's First Schedule. */
export const KENYA_COUNTIES = ${literal(KENYA_COUNTIES)};

/** Countries a family member may be registering from, Kenya first. */
export const COUNTRIES = ${literal(COUNTRIES)};

/** How a family member is related to the person they follow. */
export const RELATIONSHIPS = ${literal(RELATIONSHIPS)};

export const RELATIONSHIP_VALUES = RELATIONSHIPS.map((r) => r.value);
export const COUNTRY_CODES = COUNTRIES.map((c) => c.code);

/** The dial code for a country, falling back to Kenya's. */
export function dialCodeFor(countryCode) {
  const match = COUNTRIES.find((c) => c.code === countryCode);
  return match && match.dialCode ? match.dialCode : '+254';
}

/** The display name for a country code, for read-back in summaries. */
export function countryNameFor(countryCode) {
  const match = COUNTRIES.find((c) => c.code === countryCode);
  return match ? match.name : countryCode;
}
`;

if (process.argv.includes('--check')) {
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (current !== output) {
    console.error('mobile/src/data/locality.js is out of date. Run: npm run sync:locality');
    process.exit(1);
  }
  console.log('locality data is in sync');
} else {
  fs.writeFileSync(TARGET, output);
  console.log(`wrote ${path.relative(process.cwd(), TARGET)} ` +
    `(${KENYA_COUNTIES.length} counties, ${COUNTRIES.length} countries, ${RELATIONSHIPS.length} relationships)`);
}
