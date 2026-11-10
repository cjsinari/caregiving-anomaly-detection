const pool = require('../config/db');

/*
 * Resource authorization: may this account perform this action on this record?
 *
 * Roles alone are not enough here. "caregiver" does not mean "may read care
 * records"; it means "may read the records of the people this caregiver has been
 * assigned to". The decision is therefore per-resource (ownership), not just
 * per-role (RBAC), and it is made from the database rather than from the access
 * token: a token issued before an account was suspended, or before an assignment
 * was ended, must not still open the record. One query answers all of it, so
 * paying for freshness costs a single round trip.
 *
 * The access matrix for a care profile (elderly_profiles):
 *
 *   family member who created it   read, write, delete, manage care team
 *   caregiver, active assignment   read only
 *   caregiver, ended assignment    nothing
 *   any other family member        nothing
 *   administrator                  nothing (see below)
 *   account not active             nothing
 *
 * Administrators are deliberately excluded from care records. Their job in this
 * system is verifying caregiver accounts and reviewing the audit trail, and
 * neither needs an elderly person's address or medical notes; giving every
 * administrator standing access to them would be the largest single pool of
 * health data in the service and is not required for any function they perform
 * (data minimisation, Kenya DPA 2019). Administrators who need a record for a
 * dispute go through the family member who owns it, and the request is visible
 * in the audit trail either way.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIONS = ['read', 'write', 'delete', 'manage'];

const PROFILE_WITH_ACTOR = `
  SELECT u.id              AS actor_id,
         u.role            AS actor_role,
         u.account_status  AS actor_status,
         p.id              AS profile_id,
         p.family_member_id,
         p.full_name,
         p.home_address,
         p.date_of_birth,
         p.medical_notes,
         p.created_at,
         p.updated_at,
         a.id              AS assignment_id,
         a.status          AS assignment_status,
         a.start_date,
         a.end_date
  FROM users u
  LEFT JOIN elderly_profiles p ON p.id = $2::uuid
  LEFT JOIN LATERAL (
    SELECT asg.id, asg.status, asg.start_date, asg.end_date
    FROM assignments asg
    WHERE asg.elderly_profile_id = p.id AND asg.caregiver_id = u.id
    ORDER BY (asg.status = 'active') DESC, asg.created_at DESC
    LIMIT 1
  ) a ON TRUE
  WHERE u.id = $1::uuid`;

const asDate = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * deny/allow helpers.
 *
 * `visible` is what separates a 404 from a 403. A caller who is not entitled to
 * know the record exists gets "not found", so the API cannot be used to discover
 * which care profiles exist by probing identifiers. A caller who may see the
 * record but not perform this action on it gets a 403 that says why — hiding it
 * from them would only be confusing.
 */
const deny = (code, { visible = false, context = {}, resource = null } = {}) =>
  ({ allowed: false, code, visible, status: visible ? 403 : 404, context, resource });

const allow = (code, { context = {}, resource = null } = {}) =>
  ({ allowed: true, code, visible: true, status: 200, context, resource });

const publicProfile = (row) => ({
  id: row.profile_id,
  fullName: row.full_name,
  homeAddress: row.home_address,
  dateOfBirth: asDate(row.date_of_birth),
  medicalNotes: row.medical_notes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Decide a caregiver's standing from the single most relevant assignment row. */
function caregiverStanding(row) {
  if (!row.assignment_id) return deny('no_assignment');
  if (row.assignment_status !== 'active') {
    return row.end_date
      ? deny('assignment_ended', { context: { endedOn: asDate(row.end_date) } })
      : deny('assignment_inactive');
  }
  // An active row can still be outside its window: ending an assignment sets a
  // date, and an assignment can be dated to start later.
  if (row.end_date && asDate(row.end_date) < today()) {
    return deny('assignment_ended', { context: { endedOn: asDate(row.end_date) } });
  }
  if (row.start_date && asDate(row.start_date) > today()) {
    return deny('assignment_not_started', { context: { startsOn: asDate(row.start_date) } });
  }
  return allow('caregiver_assignment', { context: { since: asDate(row.start_date) } });
}

/**
 * Authorize one action on one care profile.
 *
 * Returns { allowed, code, status, visible, resource, context }. `code` is the
 * machine-readable reason (explanation.js turns it into a sentence for the audit
 * trail) and `resource` is the loaded profile whenever the caller is entitled to
 * it, so an authorized handler does not query for it a second time.
 */
async function authorizeProfile({ actorId, resourceId, action }) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown action: ${action}`);
  if (!resourceId || !UUID_RE.test(String(resourceId))) return deny('not_found');

  const { rows } = await pool.query(PROFILE_WITH_ACTOR, [actorId, resourceId]);
  const row = rows[0];
  if (!row) return deny('unknown_actor', { visible: true });
  if (row.actor_status !== 'active') {
    return deny('account_not_active', { visible: true, context: { accountStatus: row.actor_status } });
  }
  if (!row.profile_id) return deny('not_found');

  const resource = publicProfile(row);

  if (row.actor_role === 'family') {
    return row.family_member_id === row.actor_id
      ? allow('family_owner', { resource })
      : deny('not_owner');
  }

  if (row.actor_role === 'caregiver') {
    const standing = caregiverStanding(row);
    if (!standing.allowed) return standing;
    if (action !== 'read') {
      return deny('caregiver_read_only', { visible: true, context: standing.context });
    }
    return { ...standing, resource };
  }

  // administrator, and any role added later without a rule of its own
  return deny('administrator_no_clinical_access', { visible: true });
}

/**
 * The care profiles this account may read, as one query.
 *
 * This is the same rule as authorizeProfile expressed as a WHERE clause rather
 * than a branch: a family member sees the profiles they created, a caregiver sees
 * the ones they are currently assigned to, and nobody else sees anything. Listing
 * is scoped at the database, so an empty list is the correct answer for an
 * administrator rather than a filtered-down leak.
 */
async function listAccessibleProfiles(actorId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.full_name, p.home_address, p.date_of_birth, p.medical_notes,
            p.created_at, p.updated_at,
            CASE WHEN p.family_member_id = u.id THEN 'family_owner' ELSE 'caregiver_assignment' END AS via
     FROM users u
     JOIN elderly_profiles p
       ON (u.role = 'family' AND p.family_member_id = u.id)
       OR (u.role = 'caregiver' AND EXISTS (
             SELECT 1 FROM assignments a
             WHERE a.elderly_profile_id = p.id AND a.caregiver_id = u.id
               AND a.status = 'active'
               AND (a.start_date IS NULL OR a.start_date <= CURRENT_DATE)
               AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)))
     WHERE u.id = $1::uuid AND u.account_status = 'active'
     ORDER BY p.created_at DESC`,
    [actorId]
  );
  return rows.map((r) => ({
    ...publicProfile({ ...r, profile_id: r.id }),
    accessVia: r.via,
  }));
}

module.exports = { authorizeProfile, listAccessibleProfiles, publicProfile, ACTIONS, UUID_RE };
