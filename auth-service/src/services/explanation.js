/*
 * Explanation generation.
 *
 * Every security decision this service makes has to be answerable in a sentence
 * a non-technical user can read: the detection layers already produce their own
 * ("activity from X came 3 minutes after activity from Y..."), and this module
 * produces the rest — authorization decisions at the moment they are made, and a
 * readable line for any audit event whose writer recorded no explanation.
 *
 * Two rules the wording follows:
 *
 *  - No personal data in the sentence. An explanation is stored next to the
 *    resource_type/resource_id columns and is read by administrators, who under
 *    this service's model have no clinical access; naming the elderly person in
 *    the audit text would hand it to them anyway. The identifiers are in their
 *    own columns for whoever is entitled to resolve them.
 *  - Third person, descriptive. These sentences are a record, not a message to
 *    the user; the user-facing wording lives in the API responses and the SMS
 *    templates.
 */

const RESOURCE_LABEL = {
  elderly_profile: 'a care profile',
  assignment: 'a caregiver assignment',
  audit_trail: 'the security audit trail',
  account: 'an account',
  session: 'a session',
  anomaly: 'the anomaly review data',
  security_stats: 'the security statistics',
  security_stream: 'the live security feed',
};

const ACTION_LABEL = {
  read: 'Read',
  write: 'Write',
  delete: 'Delete',
  manage: 'Caregiver-assignment',
  create: 'Create',
  list: 'List',
  freeze: 'Account freeze',
  restore: 'Account restore',
  block_session: 'Session block',
  lock: 'Account lock',
  export: 'Export',
  review: 'Anomaly review',
  require_step_up: 'Step-up requirement',
};

/** The reason half of an access explanation, keyed by the code resourceAccess returns. */
const ACCESS_REASON = {
  // allow
  family_owner: () => 'the requester is the family member who registered it',
  caregiver_assignment: (c) =>
    `the requester has an active caregiver assignment to it${c.since ? ` (since ${c.since})` : ''}`,

  // deny
  not_found: () => 'no resource with that identifier exists',
  not_owner: () => "it belongs to another family member's account",
  no_assignment: () => 'the requester has no caregiver assignment to it',
  assignment_ended: (c) =>
    `the requester's caregiver assignment ended${c.endedOn ? ` on ${c.endedOn}` : ''}`,
  assignment_not_started: (c) =>
    `the requester's caregiver assignment does not start until ${c.startsOn}`,
  assignment_inactive: () => 'the requester\'s caregiver assignment is no longer active',
  caregiver_read_only: () =>
    'caregivers may read a profile they are assigned to but not change it or its care team',
  administrator_no_clinical_access: () =>
    'administrator accounts verify users and review the audit trail, and are not given access to care records',
  account_not_active: (c) => `the requesting account is ${c.accountStatus || 'not active'}`,
  unknown_actor: () => 'the requesting account no longer exists',
  role_not_permitted: (c) => `a ${c.role || 'account'} account may not perform this action`,
  cannot_act_on_self: () => 'an administrator may not apply this action to their own account',
  administrator_target_protected: () =>
    'administrator accounts are protected from this action by the security policy',
};

/**
 * The sentence stored on an authorization audit row.
 * e.g. "Read access to a care profile was denied: the requester has no caregiver
 *       assignment to it."
 */
function forAccess({ decision, code, action, resourceType, context = {} }) {
  const reason = ACCESS_REASON[code];
  const subject = `${ACTION_LABEL[action] || 'Access'} access to ` +
    `${RESOURCE_LABEL[resourceType] || 'a resource'}`;
  const verdict = decision === 'allow' ? 'was allowed' : 'was denied';
  return reason
    ? `${subject} ${verdict}: ${reason(context)}.`
    : `${subject} ${verdict}.`;
}

/*
 * Fallback wording for audit events written without an explanation.
 *
 * Most of these are routine ("signed in", "logged out") and were never given an
 * explanation at the point they were written, because there was nothing to
 * explain. The audit view still needs a line for them, or the dashboard shows a
 * column of blanks next to the interesting rows.
 */
const round = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 10) / 10 : null);

const GOVERNED_BY = {
  model: 'the anomaly model',
  rules: 'the device rules',
  rules_geo: 'the impossible-travel rule',
  rules_cold_start: 'the cold-start rules',
};

const riskPhrase = (d) => {
  const score = round(d.riskScore);
  if (score === null) return '';
  const by = GOVERNED_BY[d.governedBy];
  return ` Risk score ${score}${by ? `, decided by ${by}` : ''}.`;
};

const EVENT_TEMPLATE = {
  registration_started: (d) =>
    `Registration started${d.role ? ` for a ${d.role} account` : ''}; a verification code was sent.`,
  registration_completed: (d) =>
    `Registration completed${d.role ? ` for a ${d.role} account` : ''}; the device used was trusted.`,
  login_success: (d) =>
    `Signed in successfully${d.viaStepUp ? ' after passing extra verification' : ''}` +
    `${d.coldStart ? ', with no behavioural baseline yet' : ''}.${riskPhrase(d)}`,
  login_blocked: (d) => `Sign-in blocked and the account frozen as a precaution.${riskPhrase(d)}`,
  step_up_required: (d) => `Extra verification was required before this sign-in.${riskPhrase(d)}`,
  step_up_passed: (d) =>
    `Extra verification passed${d.deviceTrusted ? ' and the device was trusted' : ''}.`,
  otp_failed: (d) =>
    `An incorrect or expired verification code was submitted${d.purpose ? ` (${d.purpose})` : ''}.`,
  otp_lockout: () => 'The account was locked after repeated incorrect verification codes.',
  token_refreshed: () => 'The session was extended with a new access token.',
  logout: () => 'Signed out; the session was ended.',
  device_untrusted: () =>
    'A trusted device was removed; it will need verification again on the next sign-in.',
  session_flagged: (d) => `The session was ended because of unusual activity (${d.reason || 'anomaly'}).`,
  impossible_travel: (d) =>
    `Activity appeared from two places too far apart to have travelled between` +
    `${d.stage ? ` (detected at ${d.stage})` : ''}.`,
  api_velocity_throttled: (d) =>
    `Requests were throttled: an unusually high request rate for this ${d.scope || 'session'}.`,
  profile_created: () => 'A care profile was created.',
  profile_updated: (d) =>
    `A care profile was updated${d.fields?.length ? ` (${d.fields.join(', ')})` : ''}.`,
  profile_deleted: () => 'A care profile was deleted, along with its caregiver assignments.',
  caregiver_assigned: () =>
    'A caregiver was given access to a care profile by the family member who owns it.',
  caregiver_unassigned: () => "A caregiver's access to a care profile was ended.",
  admin_data_viewed: (d) =>
    'An administrator opened the security history of one '
    + `${d.view === 'sessions' ? 'session' : 'account'}`
    + `${d.view ? ` from the ${String(d.view).replace(/_/g, ' ')} view` : ''}.`,
  admin_export: (d) =>
    `An administrator exported the security history to a file${d.rows != null ? ` (${d.rows} rows)` : ''}.`
    + ' The file leaves the service, so access to it is no longer controlled here.',
  audit_viewed: (d) =>
    `An administrator read the audit trail${d.targetUserId && d.targetUserId !== 'all' ? ' of one account' : ''}` +
    `${d.rows != null ? ` (${d.rows} entries)` : ''}.`,
  account_frozen: (d) =>
    `The account was frozen${d.initiatedBy === 'administrator' ? ' by an administrator' : ' automatically'}` +
    `${d.endedSessions ? `, ending ${d.endedSessions} active session(s)` : ''}.`,
  account_restored: (d) =>
    `Access to the account was restored${d.previousStatus ? ` (it was ${d.previousStatus})` : ''}.`,
  session_blocked: () => 'A session was ended by an administrator.',
  account_locked: (d) =>
    `The account was locked for ${d.minutes || 'a period'} minute(s) by an administrator`
    + `${d.reason ? `: ${d.reason}` : '.'}`,
  step_up_required_by_admin: (d) =>
    "An administrator removed this account's trusted devices, so its next sign-in from any "
    + `device needs extra verification${d.reason ? `: ${d.reason}` : '.'}`,
  anomaly_reviewed: (d) =>
    d.reviewStatus === 'false_positive'
      ? 'An administrator recorded that the service was wrong to flag this sign-in.'
      : d.reviewStatus === 'true_positive'
        ? 'An administrator confirmed this sign-in was correctly flagged.'
        : 'An administrator marked this sign-in as still under review.',
  resource_access: (d) => `Access to a resource was ${d.decision === 'deny' ? 'denied' : 'allowed'}.`,
};

/**
 * The display line for one audit row. Prefers what the writer recorded; falls
 * back to a template; never returns an empty string, so a dashboard can print
 * this column unconditionally.
 */
function forEvent(row) {
  if (row.explanation) return row.explanation;

  let detail = row.event_detail;
  if (typeof detail === 'string') {
    try { detail = JSON.parse(detail); } catch { detail = { text: detail }; }
  }
  detail = detail && typeof detail === 'object' ? detail : {};

  const template = EVENT_TEMPLATE[row.event_type];
  if (template) {
    try { return template(detail); } catch { /* fall through to the generic line */ }
  }
  return `Recorded event: ${String(row.event_type).replace(/_/g, ' ')}.`;
}

/*
 * Which signals made an anomaly look anomalous.
 *
 * anomaly_scores.explanation already holds the sentence the ML engine wrote, and
 * that stays the headline — it is the engine's own account of the decision and
 * must not be paraphrased here. What the review screen additionally needs is the
 * same reasoning broken out per signal, so an administrator can see the value
 * that was observed next to the reason it mattered, rather than a JSON blob of
 * five numbers.
 *
 * This is a rule layer over the model's INPUTS, exactly as the engine's own
 * generate_explanation() is. It is not feature attribution: an Isolation Forest
 * score cannot be decomposed into per-feature contributions, and presenting it
 * as though it could would tell an administrator something the model never said.
 * `contributed` therefore means "this signal is outside the normal range", not
 * "this signal caused the score".
 *
 * CUTS mirror explanation_cutoffs in ml-engine/models/model_metadata_synthetic.json,
 * which is where they are derived from the training data. They are overridable so
 * that a deployment whose model was retrained with different cutoffs can pass the
 * engine's live values (GET /admin/model reports them) instead of these defaults.
 */
const CUTS = {
  time_deviation: Number(process.env.EXPLAIN_CUT_TIME_DEVIATION) || 8.5,
  login_velocity: Number(process.env.EXPLAIN_CUT_LOGIN_VELOCITY) || 3.0,
};

const hour = (h) => {
  const n = Number(h);
  if (!Number.isFinite(n)) return 'an unrecorded hour';
  return `${String(Math.floor(n)).padStart(2, '0')}:00`;
};

/*
 * One descriptor per signal: how to render its value, whether it is outside the
 * normal range, and the sentence for each outcome. login_hour has no cutoff of
 * its own — time_deviation is how far it sits from the account's usual hour, and
 * that is the signal the model was given — so it is reported as context only.
 */
const SIGNALS = [
  {
    feature: 'is_known_device',
    label: 'Device',
    display: (v) => (v === 0 ? 'not seen on this account before' : 'a device this account has used'),
    unusual: (v) => v === 0,
    why: 'A sign-in from a device with no history on the account is the signal most often '
       + 'present when a stolen credential is used.',
    normal: 'The device has been used on this account before.',
  },
  {
    feature: 'is_known_country',
    label: 'Country',
    display: (v) => (v === 0 ? 'a country this account has not signed in from' : 'a familiar country'),
    unusual: (v) => v === 0,
    why: 'The account has no successful sign-in from this country, so either the person '
       + 'has travelled or someone else is using the account.',
    normal: 'The country matches earlier successful sign-ins.',
  },
  {
    feature: 'is_known_city',
    label: 'City',
    display: (v) => (v === 0 ? 'a city this account has not signed in from' : 'a familiar city'),
    unusual: (v) => v === 0,
    why: 'A new city within a familiar country is a weaker signal than a new country, '
       + 'and is common for someone who travels within Kenya.',
    normal: 'The city matches earlier successful sign-ins.',
  },
  {
    feature: 'login_velocity',
    label: 'Recent attempts',
    display: (v) => `${v} sign-in attempt${Number(v) === 1 ? '' : 's'} in the preceding window`,
    unusual: (v) => Number(v) > CUTS.login_velocity,
    why: `More than ${CUTS.login_velocity} attempts in the window is the pattern of someone `
       + 'working through codes or passwords rather than signing in once.',
    normal: 'The number of recent attempts is in the usual range for this account.',
  },
  {
    feature: 'time_deviation',
    label: 'Time of day',
    display: (v) => `${Number(v).toFixed(1)} hours from this account's usual sign-in time`,
    unusual: (v) => Number(v) > CUTS.time_deviation,
    why: `A gap of more than ${CUTS.time_deviation} hours from the account's established hours `
       + 'means the sign-in happened at a time this person does not normally use the service.',
    normal: "The time of day is close to when this account normally signs in.",
  },
  {
    feature: 'login_hour',
    label: 'Hour',
    display: hour,
    unusual: () => false,                    // context for the row above, not a signal of its own
    why: null,
    normal: 'Recorded for context; the model judges the hour through its deviation, above.',
  },
];

/**
 * Break a stored feature set into per-signal rows, the unusual ones first.
 *
 * `knownDevice` is passed separately because is_known_device is not one of the
 * five model features — it is recorded in its own anomaly_scores column — and the
 * engine's explanation reads it the same way. Features the row does not carry are
 * omitted rather than reported as normal: a feature set written by an older
 * version of the extractor should leave a gap, not a reassurance.
 */
function contributingFeatures(features = {}, { knownDevice = null } = {}) {
  const values = { ...(features || {}) };
  if (knownDevice !== null && values.is_known_device === undefined) {
    values.is_known_device = knownDevice ? 1 : 0;
  }

  return SIGNALS
    .filter((s) => values[s.feature] !== undefined && values[s.feature] !== null)
    .map((s) => {
      const value = values[s.feature];
      const contributed = s.unusual(value);
      return {
        feature: s.feature,
        label: s.label,
        value,
        observed: s.display(value),
        contributed,
        explanation: contributed ? s.why : s.normal,
      };
    })
    .sort((a, b) => Number(b.contributed) - Number(a.contributed));
}

/**
 * One sentence summarising a stored anomaly, used where there is room for a line
 * but not for the signal table: the engine's own explanation when it recorded
 * one, and otherwise a line assembled from the signals that stand out.
 */
function forAnomaly(row = {}) {
  if (row.explanation) return row.explanation;

  const signals = contributingFeatures(row.features, { knownDevice: row.known_device })
    .filter((s) => s.contributed);
  const score = round(row.isolation_forest_score);
  const prefix = score === null ? 'This sign-in' : `Risk score ${score}`;

  if (!signals.length) {
    return `${prefix}: no individual signal was outside its normal range.`;
  }
  return `${prefix}: ${signals.map((s) => `${s.label.toLowerCase()} was ${s.observed}`).join('; ')}.`;
}

module.exports = {
  forAccess, forEvent, forAnomaly, contributingFeatures,
  ACCESS_REASON, EVENT_TEMPLATE, SIGNALS, CUTS,
};
