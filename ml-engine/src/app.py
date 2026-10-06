from flask import Flask, jsonify
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ML engine running',
        'model_loaded': False
    })

@app.route('/score', methods=['POST'])
def score():
    # Full scoring logic added after model training
    return jsonify({
        'riskScore': 0,
        'riskLevel': 'low',
        'explanation': 'Model not yet trained'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)