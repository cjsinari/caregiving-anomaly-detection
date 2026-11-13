/*
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
export const KENYA_COUNTIES = [
  "Baringo",
  "Bomet",
  "Bungoma",
  "Busia",
  "Elgeyo-Marakwet",
  "Embu",
  "Garissa",
  "Homa Bay",
  "Isiolo",
  "Kajiado",
  "Kakamega",
  "Kericho",
  "Kiambu",
  "Kilifi",
  "Kirinyaga",
  "Kisii",
  "Kisumu",
  "Kitui",
  "Kwale",
  "Laikipia",
  "Lamu",
  "Machakos",
  "Makueni",
  "Mandera",
  "Marsabit",
  "Meru",
  "Migori",
  "Mombasa",
  "Murang'a",
  "Nairobi",
  "Nakuru",
  "Nandi",
  "Narok",
  "Nyamira",
  "Nyandarua",
  "Nyeri",
  "Samburu",
  "Siaya",
  "Taita-Taveta",
  "Tana River",
  "Tharaka-Nithi",
  "Trans Nzoia",
  "Turkana",
  "Uasin Gishu",
  "Vihiga",
  "Wajir",
  "West Pokot"
];

/** Countries a family member may be registering from, Kenya first. */
export const COUNTRIES = [
  {
    "code": "KE",
    "name": "Kenya",
    "dialCode": "+254"
  },
  {
    "code": "US",
    "name": "United States",
    "dialCode": "+1"
  },
  {
    "code": "GB",
    "name": "United Kingdom",
    "dialCode": "+44"
  },
  {
    "code": "CA",
    "name": "Canada",
    "dialCode": "+1"
  },
  {
    "code": "AU",
    "name": "Australia",
    "dialCode": "+61"
  },
  {
    "code": "DE",
    "name": "Germany",
    "dialCode": "+49"
  },
  {
    "code": "AE",
    "name": "United Arab Emirates",
    "dialCode": "+971"
  },
  {
    "code": "QA",
    "name": "Qatar",
    "dialCode": "+974"
  },
  {
    "code": "SA",
    "name": "Saudi Arabia",
    "dialCode": "+966"
  },
  {
    "code": "OM",
    "name": "Oman",
    "dialCode": "+968"
  },
  {
    "code": "ZA",
    "name": "South Africa",
    "dialCode": "+27"
  },
  {
    "code": "UG",
    "name": "Uganda",
    "dialCode": "+256"
  },
  {
    "code": "TZ",
    "name": "Tanzania",
    "dialCode": "+255"
  },
  {
    "code": "RW",
    "name": "Rwanda",
    "dialCode": "+250"
  },
  {
    "code": "IE",
    "name": "Ireland",
    "dialCode": "+353"
  },
  {
    "code": "NL",
    "name": "Netherlands",
    "dialCode": "+31"
  },
  {
    "code": "SE",
    "name": "Sweden",
    "dialCode": "+46"
  },
  {
    "code": "NO",
    "name": "Norway",
    "dialCode": "+47"
  },
  {
    "code": "DK",
    "name": "Denmark",
    "dialCode": "+45"
  },
  {
    "code": "FI",
    "name": "Finland",
    "dialCode": "+358"
  },
  {
    "code": "FR",
    "name": "France",
    "dialCode": "+33"
  },
  {
    "code": "BE",
    "name": "Belgium",
    "dialCode": "+32"
  },
  {
    "code": "CH",
    "name": "Switzerland",
    "dialCode": "+41"
  },
  {
    "code": "IT",
    "name": "Italy",
    "dialCode": "+39"
  },
  {
    "code": "ES",
    "name": "Spain",
    "dialCode": "+34"
  },
  {
    "code": "PT",
    "name": "Portugal",
    "dialCode": "+351"
  },
  {
    "code": "NZ",
    "name": "New Zealand",
    "dialCode": "+64"
  },
  {
    "code": "IN",
    "name": "India",
    "dialCode": "+91"
  },
  {
    "code": "CN",
    "name": "China",
    "dialCode": "+86"
  },
  {
    "code": "JP",
    "name": "Japan",
    "dialCode": "+81"
  },
  {
    "code": "OTHER",
    "name": "Other",
    "dialCode": ""
  }
];

/** How a family member is related to the person they follow. */
export const RELATIONSHIPS = [
  {
    "value": "child",
    "label": "Son / Daughter"
  },
  {
    "value": "spouse",
    "label": "Husband / Wife"
  },
  {
    "value": "parent",
    "label": "Father / Mother"
  },
  {
    "value": "sibling",
    "label": "Brother / Sister"
  },
  {
    "value": "grandchild",
    "label": "Grandson / Granddaughter"
  },
  {
    "value": "niece_nephew",
    "label": "Niece / Nephew"
  },
  {
    "value": "in_law",
    "label": "In-law"
  },
  {
    "value": "guardian",
    "label": "Legal guardian"
  },
  {
    "value": "other",
    "label": "Other"
  }
];

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
