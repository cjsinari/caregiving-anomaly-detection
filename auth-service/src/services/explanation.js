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
  audit_viewed: (d) =>
    `An administrator read the audit trail${d.targetUserId && d.targetUserId !== 'all' ? ' of one account' : ''}` +
    `${d.rows != null ? ` (${d.rows} entries)` : ''}.`,
  account_frozen: (d) =>
    `The account was frozen${d.initiatedBy === 'administrator' ? ' by an administrator' : ' automatically'}` +
    `${d.endedSessions ? `, ending ${d.endedSessions} active session(s)` : ''}.`,
  account_restored: (d) =>
    `Access to the account was restored${d.previousStatus ? ` (it was ${d.previousStatus})` : ''}.`,
  session_blocked: () => 'A session was ended by an administrator.',
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

module.exports = { forAccess, forEvent, ACCESS_REASON, EVENT_TEMPLATE };
