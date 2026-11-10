-- Module 5, part 2: account security actions
--
-- An audit row already says what happened and to which resource. For a security
-- action it also has to say WHO decided: the risk engine acting on its own, or a
-- named administrator. "Account frozen" means two very different things in an
-- incident review depending on the answer, and after the fact there is no way to
-- infer it from the other columns.

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_actor_type_check') THEN
    ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_actor_type_check
      CHECK (actor_type IS NULL OR actor_type IN ('user', 'administrator', 'automated', 'system'));
  END IF;
END $$;

-- Security actions against one account, newest first: resource_type = 'account'
-- and resource_id = the account acted on, which is not the same as user_id (the
-- account that acted).
CREATE INDEX IF NOT EXISTS idx_audit_actions
  ON audit_logs (action, logged_at DESC) WHERE action IS NOT NULL;

-- ── Append-only trigger, extended for actor_type ────────────────────────────
-- The trigger whitelists an unchanged row, so a column it does not know about
-- would be free to change. Re-created here with actor_type included; everything
-- else is as it was in resource_authz.sql.
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
     AND NEW.actor_type IS NOT DISTINCT FROM OLD.actor_type
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

-- The audit trail is the record of a security action, so it needs to be
-- searchable by the account that was acted on, not only by the actor.
CREATE INDEX IF NOT EXISTS idx_audit_session_time ON audit_logs (session_id, logged_at DESC);
