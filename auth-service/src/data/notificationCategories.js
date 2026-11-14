/*
 * The push notification categories each role may switch off.
 *
 * Defined on the service because the service is what will send the pushes,
 * and so is the only place a "never mutable" rule can actually be enforced.
 * The app's settings screen reads this list from GET /auth/me/preferences
 * rather than keeping its own copy, so the two cannot disagree about what a
 * toggle means.
 *
 * ── What can never be switched off, and why ──
 *
 * Account security notices, for everybody: a new device, a session ended for
 * your safety, a phone number changed. These are how an account owner finds
 * out that somebody else is in their account. Letting them be muted would let
 * whoever is in the account mute them first.
 *
 * Incidents, for family members: a fall, an injury, anything the caregiver
 * filed as an incident about their relative. A family member who turned off
 * "completed visits" because they were too frequent has not thereby asked not
 * to hear that their mother fell.
 *
 * Neither appears as a category, and PUT /auth/me/preferences rejects an
 * attempt to set one.
 */
const CATEGORIES = {
  caregiver: [
    // Not just "Assignments": that is also the name of a destination in the
    // caregiver's sidebar, and two controls with one name on one screen is an
    // ambiguity for anyone navigating by name.
    { key: 'assignments', label: 'Assignment changes', hint: 'When someone is added to or removed from your caseload' },
    { key: 'schedule', label: 'Schedule changes', hint: 'Visits added, moved or cancelled' },
    { key: 'reminders', label: 'Visit reminders', hint: 'A reminder before each visit' },
  ],
  family: [
    { key: 'visit', label: 'Completed visits', hint: 'A message each time a visit report is filed' },
    { key: 'note', label: 'Care notes', hint: 'Notes the care team writes between visits' },
    { key: 'schedule', label: 'Schedule changes', hint: 'Visits added, moved or cancelled' },
  ],
};

const ALWAYS_ON = {
  caregiver: ['account'],
  family: ['incident', 'account'],
};

const categoriesFor = (role) => CATEGORIES[role] || [];
const alwaysOnFor = (role) => ALWAYS_ON[role] || ['account'];

module.exports = { categoriesFor, alwaysOnFor };
