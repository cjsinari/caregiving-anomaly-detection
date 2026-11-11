/*
 * Which defence recorded an event.
 *
 * The service detects in three places, and an administrator reviewing a week of
 * events needs to know which one fired, because the three fail differently and
 * are tuned differently:
 *
 *   pre_login  the risk model scores a sign-in attempt after the OTP passes and
 *              decides allow / step-up / block. Tuned by model thresholds.
 *   session    an already-authenticated session starts behaving oddly —
 *              impossible travel between two requests, or a request rate above
 *              the hard limit. Tuned by velocity limits and travel speed.
 *   resource   someone asks for a care record they are not entitled to. Not a
 *              detector at all: a deterministic ownership decision, where a
 *              refusal means the rules worked rather than that something is
 *              uncertain.
 *
 * A fourth, `administration`, holds what administrators and the response policy
 * did: freezes, restores, session blocks, reads of the trail. The issue asks for
 * three layers and these are not one of them, but they are not a *detection*
 * layer either, and filing "an administrator froze an account" under `resource`
 * because it touched a row would make the resource layer's numbers meaningless.
 * A review screen that counted administrator actions as detections would report
 * the response to an incident as more incidents.
 *
 * Classified by event type here rather than stored on the row. The mapping is a
 * reading of what each event means, and readings get revised; a layer column
 * written at insert time would freeze today's reading into years of history and
 * would need a backfill every time the vocabulary changed.
 */

const LAYERS = {
  pre_login: [
    'registration_started',
    'registration_completed',
    'login_success',
    'login_blocked',
    'step_up_required',
    'step_up_passed',
    'otp_failed',
    'otp_lockout',
  ],
  session: [
    'token_refreshed',
    'logout',
    'session_flagged',
    'impossible_travel',
    'api_velocity_throttled',
    'device_untrusted',
  ],
  resource: [
    'resource_access',
    'profile_created',
    'profile_updated',
    'profile_deleted',
    'caregiver_assigned',
    'caregiver_unassigned',
  ],
  administration: [
    'audit_viewed',
    'admin_data_viewed',
    'account_frozen',
    'account_restored',
    'session_blocked',
  ],
};

const KEYS = Object.keys(LAYERS);

const LABEL = {
  pre_login: 'Sign-in',
  session: 'Session',
  resource: 'Resource access',
  administration: 'Administration',
  other: 'Unclassified',
};

const DESCRIPTION = {
  pre_login: 'The risk model scoring a sign-in attempt, and what it decided.',
  session: 'An authenticated session behaving unusually — impossible travel, or too many requests.',
  resource: 'Requests for care records, allowed or refused by the ownership rules.',
  administration: 'Administrator actions and reads of the audit trail.',
  other: 'Event types this version does not classify.',
};

/** Reverse index: event type to layer, built once. */
const BY_EVENT = new Map();
for (const [layer, types] of Object.entries(LAYERS)) {
  for (const type of types) BY_EVENT.set(type, layer);
}

/**
 * The layer an event type belongs to.
 *
 * Unknown types answer 'other' rather than being forced into a layer. A new
 * event type added elsewhere in the service should show up as unclassified —
 * visibly, in its own bucket — instead of quietly inflating whichever layer
 * happened to be the default.
 */
const forEvent = (eventType) => BY_EVENT.get(eventType) || 'other';

/**
 * A SQL CASE expression mapping event_type to a layer, generated from the map
 * above so the database and the application cannot disagree.
 *
 * Every value is a literal from this file — no caller input reaches it — and
 * it is still built by quoting through a whitelist rather than string
 * concatenation of arbitrary text, so the generator cannot become an injection
 * point if someone later makes the layers configurable.
 */
function sqlCase(column = 'a.event_type') {
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const branches = Object.entries(LAYERS)
    .map(([layer, types]) => `WHEN ${column} IN (${types.map(quote).join(', ')}) THEN ${quote(layer)}`)
    .join('\n           ');
  return `CASE ${branches}\n           ELSE 'other' END`;
}

module.exports = { LAYERS, KEYS, LABEL, DESCRIPTION, forEvent, sqlCase };
