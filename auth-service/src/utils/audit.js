const pool = require('../config/db');

/**
 * Append a security event to the audit trail.
 * Never throws: a failed audit write must not break the request that triggered it
 */
async function logEvent({
  userId = null,
  sessionId = null,
  eventType,
  detail = null,
  explanation = null,
  severity = 'info',
}) {
  try {
    const detailText = detail && typeof detail === 'object' ? JSON.stringify(detail) : detail;
    await pool.query(
      `INSERT INTO audit_logs (user_id, session_id, event_type, event_detail, explanation, severity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, sessionId, eventType, detailText, explanation, severity]
    );
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
}

module.exports = { logEvent };