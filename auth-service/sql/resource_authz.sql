-- Module 5: resource authorization and the audit trail
--
-- The audit trail stops being a list of things that starts recording WHAT was touched
-- and whether the attempt was allowed, so "who read this care record?" is answerable.
-- It becomes append-only, so the record of an unauthorised access cannot be edited away by
-- the account that made it.

-- ── Audit trail: resource and decision columns ──────────────────────────────
-- event_detail stays TEXT (it holds JSON for some event types and a bare string
-- for others, and existing rows must keep parsing); the columns below are the
-- ones the dashboard filters and joins on, so they are typed and indexed.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type VARCHAR(40);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS action VARCHAR(40);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS decision VARCHAR(10);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);

-- resource_id is deliberately NOT a foreign key to elderly_profiles: the audit
-- row must survive the deletion of the thing it describes, which is exactly when
-- it matters most.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_decision_check') THEN
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_decision_check
      CHECK (decision IS NULL OR decision IN ('allow', 'deny'));
  END IF;
END $$;

-- The audit views: one user's trail, the whole trail newest-first, one event
-- type over time, and everything that ever touched one resource.
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_logs (user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs (logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_time ON audit_logs (event_type, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs (resource_type, resource_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_denials ON audit_logs (logged_at DESC) WHERE decision = 'deny';

-- ── Append-only audit trail ─────────────────────────────────────────────────
-- A trigger, not a permissions grant: the service connects as the database owner,
-- so this guards against application bugs and against a compromised service
-- account rewriting history, not against someone with superuser access. Moving
-- the service to a role with INSERT/SELECT only is the next step and is not
-- something the application can do to itself.
--
-- The one UPDATE that is allowed is the FK's ON DELETE SET NULL nulling user_id
-- or session_id when the account or session is deleted; without that exception,
-- deleting a user would fail. Every other column must be unchanged, so the
-- exception cannot be used to rewrite an event.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: rows cannot be deleted';
  END IF;

  IF NEW.id = OLD.id
     AND NEW.event_type = OLD.event_type
     AND NEW.event_detail IS NOT DISTINCT FROM OLD.event_detail
     AND NEW.explanation IS NOT DISTINCT FROM OLD.explanation
     AND NEW.severity = OLD.severity
     AND NEW.logged_at = OLD.logged_at
     AND NEW.resource_type IS NOT DISTINCT FROM OLD.resource_type
     AND NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id
     AND NEW.action IS NOT DISTINCT FROM OLD.action
     AND NEW.decision IS NOT DISTINCT FROM OLD.decision
     AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
     AND (NEW.user_id IS NULL OR NEW.user_id IS NOT DISTINCT FROM OLD.user_id)
     AND (NEW.session_id IS NULL OR NEW.session_id IS NOT DISTINCT FROM OLD.session_id)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only: recorded events cannot be modified';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

-- ── Resource ownership lookups ──────────────────────────────────────────────
-- Every authenticated request for a care profile resolves ownership, so the two
-- lookups behind it are indexed.
CREATE INDEX IF NOT EXISTS idx_elderly_profiles_owner
  ON elderly_profiles (family_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_access
  ON assignments (caregiver_id, elderly_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_profile
  ON assignments (elderly_profile_id, status);

-- One live assignment per caregiver/profile pair. Ended assignments are kept
-- (they are the record of who could see what, and when), so this is a partial
-- index rather than a table-wide unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_one_active
  ON assignments (caregiver_id, elderly_profile_id) WHERE status = 'active';
