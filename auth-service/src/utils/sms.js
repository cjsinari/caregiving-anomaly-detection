const AfricasTalking = require('africastalking');
require('dotenv').config();

const AT = AfricasTalking({
  apiKey: process.env.AFRICAS_TALKING_API_KEY,
  username: process.env.AFRICAS_TALKING_USERNAME,
});

const sms = AT.SMS;

/**
 * Send an OTP via SMS
 * @param {string} phoneNumber - E.164 format e.g. +254712345678
 * @param {string} otp - The 6-digit OTP
 * @returns {Promise}
 */
async function sendOTP(phoneNumber, otp) {
  const message = `Your MzaziCare verification code is: ${otp}. Valid for 5 minutes. Do not share this code with anyone.`;

  try {
    const response = await sms.send({
      to: [phoneNumber],
      message,
      // Remove the from field while in sandbox
      // from: process.env.AFRICAS_TALKING_SENDER_ID,
    });
    console.log('SMS sent:', response);
    return response;
  } catch (error) {
    console.error('SMS error:', error);
    throw error;
  }
}

/**
 * Send a security alert SMS
 * @param {string} phoneNumber - E.164 format
 * @param {string} message - Custom alert message
 */
async function sendSecurityAlert(phoneNumber, message) {
  try {
    const response = await sms.send({
      to: [phoneNumber],
      message,
      // from: process.env.AFRICAS_TALKING_SENDER_ID,
    });
    return response;
  } catch (error) {
    console.error('Alert SMS error:', error);
    throw error;
  }
}

module.exports = { sendOTP, sendSecurityAlert };