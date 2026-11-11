-- Module 6: administrator dashboard read paths
--
-- No new tables. The dashboard reads what the detection layers already wrote;
-- what it needs is for those reads to be cheap, because they are the only
-- queries in the service that scan a time range rather than fetch one row by
-- primary key, and they run on every dashboard refresh rather than once per
-- sign-in.
--
-- The target is the one in the issue: a filtered, paginated page in under 500 ms.
-- Every index below exists for a named query in adminDataController.js; a
-- composite index whose leading column is the one the dashboard sorts by lets
-- PostgreSQL answer "the newest N rows in this window" from the index instead of
-- sorting the whole window.

-- ── Anomaly review (GET /admin/anomalies) ───────────────────────────────────
-- anomaly_scores had no index on created_at at all: every anomaly listing was a
-- sequential scan plus a sort. This is the dashboard's default ordering.
CREATE INDEX IF NOT EXISTS idx_anomaly_scores_time
  ON anomaly_scores (created_at DESC);

-- The anomaly table's own filters: by what the system decided, and by how the
-- model classified it. Partial on action because an 'allow' is not what an
-- administrator reviews, and excluding it keeps the index small.
CREATE INDEX IF NOT EXISTS idx_anomaly_scores_action_time
  ON anomaly_scores (action, created_at DESC) WHERE action IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_anomaly_scores_risk_time
  ON anomaly_scores (risk_level, created_at DESC);

-- The join back to the account: anomaly_scores points at a login_event, which
-- points at the user, so a per-account anomaly history is driven from this side.
CREATE INDEX IF NOT EXISTS idx_anomaly_scores_login_event
  ON anomaly_scores (login_event_id);

-- ── Summary statistics (GET /admin/stats/summary) ───────────────────────────
-- The KPI cards count a window and the window before it in one pass over each
-- table, so each needs an index on its timestamp alone. login_events is already
-- indexed by (user_id, login_time) and (user_id, was_successful, login_time),
-- neither of which helps a query with no user_id: a service-wide count is the
-- dashboard's normal case.
CREATE INDEX IF NOT EXISTS idx_login_events_time
  ON login_events (login_time DESC);

-- ── Session management (GET /admin/sessions) ────────────────────────────────
-- The active-session list, newest activity first. Partial: ended sessions are
-- kept for the record but are not what this view shows by default.
CREATE INDEX IF NOT EXISTS idx_sessions_active_seen
  ON sessions (session_status, (COALESCE(last_seen_at, created_at)) DESC)
  WHERE session_status = 'active';

-- Sessions ended by a detector, which is the "blocked sessions" KPI and the
-- security-incident view. flagged_at is null on every other session, so the
-- partial index holds only the rows this query is about.
CREATE INDEX IF NOT EXISTS idx_sessions_flagged_time
  ON sessions (flagged_at DESC) WHERE flagged_reason IS NOT NULL;

-- ── Event feed (GET /admin/events) ──────────────────────────────────────────
-- audit_logs is already indexed on (logged_at DESC), (event_type, logged_at),
-- (user_id, logged_at) and a partial on denials. The dashboard adds one filter
-- those do not cover: severity over a time window, which is how an
-- administrator narrows the feed to what needs attention.
CREATE INDEX IF NOT EXISTS idx_audit_severity_time
  ON audit_logs (severity, logged_at DESC);

-- Free-text search over the feed matches an IP prefix (ILIKE 'x%'), which the
-- default btree collation cannot serve. Searching by account name goes through
-- users.full_name instead, so only the address needs its own index here.
CREATE INDEX IF NOT EXISTS idx_audit_ip_time
  ON audit_logs (ip_address, logged_at DESC) WHERE ip_address IS NOT NULL;
