-- Module 6, part 2: anomaly review and administrator response
--
-- The detection layers record what the model said and what the service did.
-- Nothing until now recorded whether the service was RIGHT, which is the one
-- piece of information that makes the model improvable: a precision figure from
-- the training set says how the model performed on data it was tuned against,
-- not how it performs on this deployment's real users at these thresholds.
--
-- An administrator reviewing a flagged sign-in already has the answer — they
-- phoned the account holder, or they recognised the address. This is where that
-- answer is kept, so a retrain has labelled production data instead of more
-- synthetic injections.

-- ── Review verdict on a scored sign-in ────────────────────────────────────
-- NULL means nobody has looked at it yet, which is the honest default and is
-- distinguishable from "looked at and found to be fine". The difference matters:
-- an unreviewed queue and an all-clear queue are the same shape otherwise.
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS review_status VARCHAR(20);
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

-- Who decided. ON DELETE SET NULL rather than CASCADE: the verdict is evidence
-- about the model and must outlive the reviewer's account, which would
-- otherwise take the training label with it.
ALTER TABLE anomaly_scores ADD COLUMN IF NOT EXISTS reviewed_by UUID
  REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anomaly_scores_review_status_check') THEN
    ALTER TABLE anomaly_scores ADD CONSTRAINT anomaly_scores_review_status_check
      CHECK (review_status IS NULL OR review_status IN
             ('true_positive', 'false_positive', 'under_review'));
  END IF;
END $$;

-- The review queue: flagged sign-ins nobody has ruled on yet, newest first.
-- Partial on both columns, because that is the only query this index is for and
-- the rows it excludes are the overwhelming majority.
CREATE INDEX IF NOT EXISTS idx_anomaly_scores_unreviewed
  ON anomaly_scores (created_at DESC)
  WHERE review_status IS NULL AND action IS DISTINCT FROM 'allow';

-- Pulling the labelled set out for a retrain, and reporting review coverage.
CREATE INDEX IF NOT EXISTS idx_anomaly_scores_reviewed
  ON anomaly_scores (review_status, reviewed_at DESC) WHERE review_status IS NOT NULL;

-- ── Account list lookups ──────────────────────────────────────────────────
-- The user list sorts by most recent activity and searches by name, neither of
-- which any existing index serves: the users table has only been queried by
-- phone number and primary key until now.
CREATE INDEX IF NOT EXISTS idx_users_role_status ON users (role, account_status);
CREATE INDEX IF NOT EXISTS idx_users_created ON users (created_at DESC);

-- Each account's last sign-in, for the user list. login_events is indexed by
-- (user_id, login_time DESC) already, which serves the per-account lookup; this
-- partial index is for the successful-only case the list actually shows.
CREATE INDEX IF NOT EXISTS idx_login_events_user_last_success
  ON login_events (user_id, login_time DESC) WHERE was_successful;
