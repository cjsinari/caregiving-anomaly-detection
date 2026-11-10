-- Module 6, part 3: hardening
--
-- ── A maximum risk score could not be stored ──
--
-- isolation_forest_score was NUMERIC(8,6): eight significant digits with six
-- after the point, so two before it. The column therefore held 0.000000 to
-- 99.999999 and rejected 100 outright.
--
-- The risk engine clamps its score with Math.min(score, 100), so 100 is a value
-- it genuinely produces — and it is the one that matters most, because it is the
-- single most dangerous sign-in the system can see. The insert raised "numeric
-- field overflow", and riskEngine.record() catches and logs rather than throwing
-- (correctly: a logging failure must not break the login it describes). The
-- result was silent and precisely wrong: the login_events row was written, the
-- anomaly_scores row was not, and the dashboard under-reported its own worst
-- detections with nothing but a console line to say so. No histogram bar, no
-- entry in the review queue, no block visible on the overview.
--
-- Six decimal places were never meaningful for a 0-100 score that is displayed
-- to one. NUMERIC(5,2) matches sessions.risk_score, which has held the same
-- quantity correctly all along, and leaves room to 999.99.
--
-- Existing values are rounded from six decimals to two. That is lossless for
-- every purpose the score is used for: the thresholds are 58.9 and 88, and
-- every screen renders it to one decimal place.
ALTER TABLE anomaly_scores
  ALTER COLUMN isolation_forest_score TYPE NUMERIC(5,2);

-- location_deviation is the same shape of quantity and was NUMERIC(8,4). It is
-- unused by the current feature set, but a column that cannot hold its own
-- documented range is a trap for whoever revives it.
ALTER TABLE anomaly_scores
  ALTER COLUMN location_deviation TYPE NUMERIC(6,2);

-- A score outside 0-100 is not a score. The clamp lives in the application,
-- where it can be reasoned about; this is the backstop that turns a future bug
-- in that clamp into a loud failure at the write rather than a quietly wrong
-- row that every chart then averages.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anomaly_scores_score_range_check') THEN
    ALTER TABLE anomaly_scores ADD CONSTRAINT anomaly_scores_score_range_check
      CHECK (isolation_forest_score IS NULL
             OR (isolation_forest_score >= 0 AND isolation_forest_score <= 100));
  END IF;
END $$;

-- sessions.risk_score carries the same quantity and deserves the same backstop.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_risk_score_range_check') THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_risk_score_range_check
      CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100));
  END IF;
END $$;
