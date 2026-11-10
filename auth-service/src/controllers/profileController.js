const { z } = require('zod');
const pool = require('../config/db');
const { parse } = require('../utils/validate');
const { toE164 } = require('../utils/phone');
const { logEvent } = require('../utils/audit');
const { maskPhone } = require('../services/notifier');
const resourceAccess = require('../services/resourceAccess');

/*
 * Care profiles: the records the authorization layer exists to protect.
 *
 * Every handler here is reached only through middleware/ownership.js, so none of
 * them re-checks who the caller is; the ones that act on a single profile read
 * req.resource, which the authorization query already loaded.
 *
 * What is audited: the authorization decision itself is written by the
 * middleware (one row per attempt, allowed or refused). These handlers add a row
 * for the change they made, because "access allowed" and "the address was
 * changed" are different facts. Field NAMES are recorded, never values: the
 * audit trail is read by administrators, who have no clinical access, and a
 * before/after of medical notes in audit_detail would quietly hand it to them.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const dateOfBirth = isoDate.refine((v) => {
  const d = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(d) && d <= Date.now() && d > Date.parse('1900-01-01T00:00:00Z');
}, 'Date of birth must be a real past date');

const profileFields = {
  fullName: z.string().trim().min(2).max(100),
  homeAddress: z.string().trim().max(500).nullable().optional(),
  dateOfBirth: dateOfBirth.nullable().optional(),
  medicalNotes: z.string().trim().max(5000).nullable().optional(),
};

const createSchema = z.object(profileFields).strict();
const updateSchema = z.object({ ...profileFields, fullName: profileFields.fullName.optional() })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Provide at least one field to update' });

const assignSchema = z.object({
  caregiverPhone: z.string().min(9).max(20),
  startDate: isoDate.optional(),
}).strict();

// column name on the left, request field on the right
const UPDATABLE = {
  full_name: 'fullName',
  home_address: 'homeAddress',
  date_of_birth: 'dateOfBirth',
  medical_notes: 'medicalNotes',
};

/** POST /profiles — a family member registers someone in their care */
async function createProfile(req, res) {
  const data = parse(createSchema, req.body, res);
  if (!data) return;
  try {
    const { rows } = await pool.query(
      `INSERT INTO elderly_profiles (family_member_id, full_name, home_address, date_of_birth, medical_notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, full_name, home_address, date_of_birth, medical_notes, created_at, updated_at`,
      [req.user.id, data.fullName, data.homeAddress ?? null,
       data.dateOfBirth ?? null, data.medicalNotes ?? null]
    );
    const profile = resourceAccess.publicProfile({ ...rows[0], profile_id: rows[0].id });

    await logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'profile_created',
      severity: 'info', resourceType: 'elderly_profile', resourceId: profile.id,
      action: 'create', decision: 'allow', ip: req.ip,
      detail: { fields: Object.keys(data) },
    });
    return res.status(201).json({ profile: { ...profile, accessVia: 'family_owner' } });
  } catch (err) {
    console.error('createProfile error:', err);
    return res.status(500).json({ error: 'Could not create the care profile. Please try again.' });
  }
}

/** GET /profiles — scoped at the database to what this account may read */
async function listProfiles(req, res) {
  try {
    const profiles = await resourceAccess.listAccessibleProfiles(req.user.id);
    return res.status(200).json({ count: profiles.length, profiles });
  } catch (err) {
    console.error('listProfiles error:', err);
    return res.status(500).json({ error: 'Could not load care profiles.' });
  }
}

/** GET /profiles/:id — authorized and audited by requireProfileAccess('read') */
async function getProfile(req, res) {
  return res.status(200).json({ profile: { ...req.resource, accessVia: req.access.via } });
}

/** PATCH /profiles/:id — owner only */
async function updateProfile(req, res) {
  const data = parse(updateSchema, req.body, res);
  if (!data) return;

  const sets = [];
  const params = [req.resource.id];
  for (const [column, field] of Object.entries(UPDATABLE)) {
    if (field in data) {
      params.push(data[field] ?? null);
      sets.push(`${column} = $${params.length}`);
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE elderly_profiles SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $1
       RETURNING id, full_name, home_address, date_of_birth, medical_notes, created_at, updated_at`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Care profile not found.' });

    await logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'profile_updated',
      severity: 'info', resourceType: 'elderly_profile', resourceId: req.resource.id,
      action: 'write', decision: 'allow', ip: req.ip,
      detail: { fields: Object.keys(data) },
    });
    return res.status(200).json({
      profile: { ...resourceAccess.publicProfile({ ...rows[0], profile_id: rows[0].id }),
                 accessVia: req.access.via },
    });
  } catch (err) {
    console.error('updateProfile error:', err);
    return res.status(500).json({ error: 'Could not update the care profile. Please try again.' });
  }
}

/** DELETE /profiles/:id — owner only; assignments go with it (ON DELETE CASCADE) */
async function deleteProfile(req, res) {
  try {
    const { rowCount } = await pool.query('DELETE FROM elderly_profiles WHERE id = $1', [req.resource.id]);
    if (!rowCount) return res.status(404).json({ error: 'Care profile not found.' });

    // The audit row outlives the record it describes: resource_id is not a
    // foreign key, so this entry survives the deletion.
    await logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'profile_deleted',
      severity: 'medium', resourceType: 'elderly_profile', resourceId: req.resource.id,
      action: 'delete', decision: 'allow', ip: req.ip,
    });
    return res.status(200).json({ message: 'Care profile deleted.' });
  } catch (err) {
    console.error('deleteProfile error:', err);
    return res.status(500).json({ error: 'Could not delete the care profile. Please try again.' });
  }
}

/** GET /profiles/:id/assignments — who can see this profile, and since when */
async function listAssignments(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.start_date, a.end_date, a.created_at,
              u.id AS caregiver_id, u.full_name, u.phone_number
       FROM assignments a JOIN users u ON u.id = a.caregiver_id
       WHERE a.elderly_profile_id = $1
       ORDER BY (a.status = 'active') DESC, a.created_at DESC`,
      [req.resource.id]
    );
    return res.status(200).json({
      assignments: rows.map((r) => ({
        id: r.id,
        status: r.status,
        startDate: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : null,
        endDate: r.end_date ? new Date(r.end_date).toISOString().slice(0, 10) : null,
        caregiver: { id: r.caregiver_id, fullName: r.full_name, phoneNumber: maskPhone(r.phone_number) },
      })),
    });
  } catch (err) {
    console.error('listAssignments error:', err);
    return res.status(500).json({ error: 'Could not load the care team.' });
  }
}

/**
 * POST /profiles/:id/assignments — the owner grants a caregiver access.
 *
 * The caregiver must be an administrator-verified, active account: assignment is
 * what turns a role into access to one person's health record, so an unverified
 * caregiver account must not be assignable.
 */
async function assignCaregiver(req, res) {
  const data = parse(assignSchema, req.body, res);
  if (!data) return;
  let phone;
  try { phone = toE164(data.caregiverPhone); } catch { return res.status(400).json({ error: 'Invalid phone number' }); }

  try {
    const { rows: found } = await pool.query(
      `SELECT id, full_name FROM users
       WHERE phone_number = $1 AND role = 'caregiver'
         AND account_status = 'active' AND phone_verified = TRUE`,
      [phone]
    );
    const caregiver = found[0];
    if (!caregiver) {
      return res.status(404).json({
        error: 'No verified caregiver account was found for that phone number.',
        code: 'CAREGIVER_NOT_FOUND',
      });
    }

    const { rows } = await pool.query(
      `INSERT INTO assignments (caregiver_id, elderly_profile_id, status, start_date)
       VALUES ($1, $2, 'active', COALESCE($3::date, CURRENT_DATE))
       RETURNING id, status, start_date`,
      [caregiver.id, req.resource.id, data.startDate || null]
    );
    const assignment = rows[0];

    await logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'caregiver_assigned',
      severity: 'medium', resourceType: 'elderly_profile', resourceId: req.resource.id,
      action: 'manage', decision: 'allow', ip: req.ip,
      detail: { assignmentId: assignment.id, caregiverId: caregiver.id,
                startDate: new Date(assignment.start_date).toISOString().slice(0, 10) },
    });

    return res.status(201).json({
      assignment: {
        id: assignment.id,
        status: assignment.status,
        startDate: new Date(assignment.start_date).toISOString().slice(0, 10),
        caregiver: { id: caregiver.id, fullName: caregiver.full_name, phoneNumber: maskPhone(phone) },
      },
    });
  } catch (err) {
    // idx_assignments_one_active: this caregiver already has live access
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'That caregiver already has access to this profile.',
        code: 'ALREADY_ASSIGNED',
      });
    }
    console.error('assignCaregiver error:', err);
    return res.status(500).json({ error: 'Could not assign the caregiver. Please try again.' });
  }
}

/**
 * DELETE /profiles/:id/assignments/:assignmentId — the owner ends a caregiver's
 * access. The row is kept and dated rather than deleted: it is the record of who
 * could read this profile between which dates, which is the question the audit
 * trail has to be able to answer afterwards.
 */
async function endAssignment(req, res) {
  if (!resourceAccess.UUID_RE.test(String(req.params.assignmentId))) {
    return res.status(404).json({ error: 'Assignment not found.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE assignments SET status = 'inactive', end_date = CURRENT_DATE
       WHERE id = $1::uuid AND elderly_profile_id = $2 AND status = 'active'
       RETURNING id, caregiver_id, end_date`,
      [req.params.assignmentId, req.resource.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Assignment not found.' });

    await logEvent({
      userId: req.user.id, sessionId: req.user.sessionId, eventType: 'caregiver_unassigned',
      severity: 'medium', resourceType: 'elderly_profile', resourceId: req.resource.id,
      action: 'manage', decision: 'allow', ip: req.ip,
      detail: { assignmentId: rows[0].id, caregiverId: rows[0].caregiver_id,
                endDate: new Date(rows[0].end_date).toISOString().slice(0, 10) },
    });
    return res.status(200).json({ message: "The caregiver's access to this profile has ended." });
  } catch (err) {
    console.error('endAssignment error:', err);
    return res.status(500).json({ error: 'Could not end the assignment. Please try again.' });
  }
}

module.exports = { createProfile, listProfiles, getProfile, updateProfile, deleteProfile,
                   listAssignments, assignCaregiver, endAssignment };
