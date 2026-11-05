const axios = require('axios');

const ML_URL = process.env.ML_ENGINE_URL || 'http://localhost:5000';
const TIMEOUT_MS = Number(process.env.ML_TIMEOUT_MS) || 800;

/**
 * Score a login against the ML engine
 *
 * If the engine is slow, down or returns something unusable, the
 * caller gets a medium-risk step-up rather than an error, matching the fallback
 * the engine itself applies. The timeout is deliberately short: the
 * whole login flow has a 300ms response target, so a hanging ML call must not
 * hold the user's login open
 */
async function score(features, { isKnownDevice }) {
  // is_known_device is not a model feature; the engine reads it only to build
  // the explanation text.
  const payload = { ...features, is_known_device: isKnownDevice ? 1 : 0 };

  try {
    const { data } = await axios.post(`${ML_URL}/score`, payload, {
      timeout: TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });

    if (typeof data.riskScore !== 'number' || !data.action) {
      throw new Error('Malformed response from ML engine');
    }
    return {
      riskScore: data.riskScore,
      riskLevel: data.riskLevel,
      action: data.action,
      isAnomaly: Boolean(data.isAnomaly),
      explanation: data.explanation,
      modelAvailable: data.modelAvailable !== false,
    };
  } catch (err) {
    const reason = err.code === 'ECONNABORTED' ? 'timed out' : err.message;
    console.error(`ML engine unavailable (${reason}); falling back to step-up`);
    return {
      riskScore: 50,
      riskLevel: 'medium',
      action: 'step_up',
      isAnomaly: false,
      explanation: 'Risk scoring unavailable. Additional verification required as a precaution.',
      modelAvailable: false,
    };
  }
}

module.exports = { score };
