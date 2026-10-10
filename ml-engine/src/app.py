from flask import Flask, request, jsonify
from dotenv import load_dotenv
from datetime import datetime, timezone
import joblib
import json
import numpy as np
import os
import pandas as pd

load_dotenv()

app = Flask(__name__)

# Resolving paths relative to the ml-engine folder, regardless of the working directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(BASE_DIR, os.getenv('MODEL_PATH', 'models/isolation_forest_synthetic.pkl'))
SCALER_PATH = os.path.join(BASE_DIR, os.getenv('SCALER_PATH', 'models/scaler_synthetic.pkl'))
META_PATH = os.path.join(BASE_DIR, 'models/model_metadata_synthetic.json')

FEATURES = [
    'login_hour',
    'login_day_of_week',
    'time_deviation',
    'is_known_country',
    'is_known_city',
    'is_foreign_login',
    'location_anomaly_score',
    'is_known_device',
    'login_velocity',
]

model = None
scaler = None
D_LOW = None    # calibration bounds saved from training using 1st/99th percentile of decision scores
D_HIGH = None
ALLLOW_MAX = 38
STEP_UP_MAX = 70

# Explanation cutoffs: fallback values, overwritten by the data-derived ones if the metadata has them
CUTS = {'time_deviation': 5, 'login_velocity': 5}

# Loading model artefacts at startup
try:
    model = joblib.load(MODEL_PATH)
    scaler = joblib.load(SCALER_PATH)
    with open(META_PATH) as f:
        _meta = json.load(f)
    D_LOW = _meta['risk_calibration']['d_low']
    D_HIGH = _meta['risk_calibration']['d_high']
    ALLOW_MAX = _meta['risk_thresholds']['allow_max']
    STEP_UP_MAX = _meta['risk_thresholds']['step_up_max']
    CUTS = {**CUTS, **_meta.get('explanation_cutoffs', {})}
    print(f"Model, scaler and calibration loaded from {BASE_DIR}")
    print(f"Explanation cutoffs: {CUTS}")
    print(f"Thresholds: allow <= {ALLOW_MAX}, step-up <= {STEP_UP_MAX}, block above")
except Exception as e:
    print(f"WARNING: Could not load model/scaler/calibration at startup: {e}")

def compute_risk_level(risk_score):
    """Map a 0-100 risk score to a graduated response level."""
    if risk_score <= ALLOW_MAX:
        return 'low', 'allow'
    elif risk_score <= STEP_UP_MAX:
        return 'medium', 'step_up'
    else:
        return 'high', 'block'

def generate_explanation(features_dict, risk_level):
    """Signal-based explanation: lists which input signals look unusual.
    This is a rule layer on the inputs, not an attribution of the model's score."""
    reasons = []

    if features_dict.get('is_known_device', 1) == 0:
        reasons.append('unrecognised device')
    if features_dict.get('is_foreign_login', 0) == 1:
        reasons.append('login from an unfamiliar country')
    elif features_dict.get('is_known_city', 1) == 0:
        reasons.append('login from an unfamiliar city')
    if features_dict.get('login_velocity', 0) > CUTS['login_velocity']:
        reasons.append(f"unusually high login frequency ({features_dict['login_velocity']} attempts)")
    if features_dict.get('time_deviation', 0) > CUTS['time_deviation']:
        reasons.append('login at an unusual time for this account')

    if not reasons:
        return "Login matches this account's established behavioural pattern."

    return f"Flagged as {risk_level} risk due to: {', '.join(reasons)}."

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ML engine running',
        'model_loaded': model is not None,
        'scaler_loaded': scaler is not None,
        'calibration_loaded': D_LOW is not None,
        'timestamp': datetime.now(timezone.utc).isoformat(),
    })

@app.route('/score', methods=['POST'])
def score():
    if model is None or scaler is None:
        # Conservative fallback per NFR12; defaulting to medium risk
        # rather than blocking all logins or allowing unchecked access
        return jsonify({
          'riskScore': 50,
          'riskLevel': 'medium',
          'action': 'step_up',
          'explanation': 'Risk model temporarily unavailable. Step-up verification required as a precaution.',
          'modelAvailble': False,
    }), 200

    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({'error': 'No JSON payload received'}), 400

        missing = [f for f in FEATURES if f not in data]
        if missing:
            return jsonify({'error': f'Missing required features: {missing}'}), 400

        # Building feature vector in the exact order the model was trained on
        feature_df = pd.DataFrame([[data[f] for f in FEATURES]], columns=FEATURES)

        # Training applied log1p to every login_velocity value 
        feature_df['login_velocity'] = np.log1p(feature_df['login_velocity'])

        # Scale using the fitted scaler from training
        scaled = pd.DataFrame(scaler.transform(feature_df), columns=FEATURES)

        # Isolation Forest decision function: higher = more normal, lower = more anomalous
        decision_score = model.decision_function(scaled)[0]
        prediction = model.predict(scaled)[0]  # 1 = normal, -1 = anomaly

        # Calibrated 0-100 risk score using fixed bounds from the training data
        risk_score = round(
            float(np.clip((D_HIGH - decision_score) / (D_HIGH - D_LOW), 0, 1) * 100), 2
        )

        risk_level, action = compute_risk_level(risk_score)
        explanation = generate_explanation(data, risk_level)

        return jsonify({
            'riskScore': risk_score,
            'riskLevel': risk_level,
            'action': action,
            'isAnomaly': bool(prediction == -1),
            'explanation': explanation,
            'modelAvailable': True,
        }), 200

    except Exception as e:
        print(f"Scoring error: {e}")
        return jsonify({
            'riskScore': 50,
            'riskLevel': 'medium',
            'action': 'step_up',
            'explanation': 'An error occurred during risk scoring. Step-up verification required as a precaution.',
            'modelAvailable': False,
            'error': str(e),
        }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('FLASK_PORT', 5000)), debug=True)