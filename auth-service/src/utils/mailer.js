const nodemailer = require('nodemailer');
require('dotenv').config();

/*
 * Email delivery, for the one thing SMS cannot do.
 *
 * Every code this service sends goes by SMS, which works until the thing being
 * recovered is the phone. Someone who changed their number, lost the handset or
 * had the SIM swapped cannot receive a text at the number on file -- and that is
 * precisely the person account recovery exists for. So recovery codes, and
 * step-up codes where a backup email exists, go to an inbox instead.
 *
 * -- Why SMTP and not a provider SDK --
 *
 * The transport is configured entirely from the environment, so the provider is
 * a deployment decision rather than a code one. Gmail, Zoho, Mailtrap, SendGrid
 * and Amazon SES all speak SMTP; swapping between them is an .env change.
 *
 * -- Development --
 *
 * With no SMTP host configured, or with OTP_DEV_MODE on, the message is printed
 * to the console instead of being sent. That mirrors utils/otp.js deliberately:
 * the inconsistency between the two -- notifier suppressed in development while
 * OTPs were not -- is what hid a bug that texted real codes to real strangers.
 * The whole recovery flow can therefore be exercised locally with no mail
 * account at all.
 */

const DEV_MODE = process.env.OTP_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
const HOST = process.env.SMTP_HOST;
const FROM = process.env.SMTP_FROM || 'LindaCare <no-reply@lindacare.co.ke>';

/** Built once, lazily: nothing should fail at import time for want of config. */
let transport;

function getTransport() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Deriving this from the
    // port rather than asking for another setting removes the single most
    // common way an SMTP configuration is wrong.
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transport;
}

/** Is there anywhere to send mail, or does it go to the console? */
const isConfigured = () => Boolean(HOST) && !DEV_MODE;

/*
 * The body of a verification message.
 *
 * Plain text as well as HTML, because a code that renders as a blank message in
 * a text-only client is a code nobody can read. The wording carries no name, no
 * account detail and no link: an email is forwardable and quotable, and a code
 * plus a link is the shape every phishing message takes.
 */
function body(code, purpose) {
  const what = purpose === 'recovery'
    ? 'regain access to your LindaCare account'
    : 'verify your LindaCare sign-in';

  const text = [
    `Your LindaCare verification code is: ${code}`,
    '',
    `Use it to ${what}. It expires in ${Number(process.env.OTP_TTL_MINUTES) || 5} minutes.`,
    '',
    'Do not share this code with anyone. LindaCare will never ask you for it.',
    'If you did not request it, you can ignore this message.',
  ].join('\n');

  const html = `<p style="font:16px system-ui,sans-serif">Your LindaCare verification code is:</p>
<p style="font:600 28px/1.2 system-ui,sans-serif;letter-spacing:4px">${code}</p>
<p style="font:14px system-ui,sans-serif;color:#55708c">Use it to ${what}. It expires in
${Number(process.env.OTP_TTL_MINUTES) || 5} minutes.</p>
<p style="font:14px system-ui,sans-serif;color:#55708c">Do not share this code with anyone.
LindaCare will never ask you for it. If you did not request it, you can ignore this message.</p>`;

  return { text, html };
}

/**
 * Send a verification code to an email address.
 *
 * Throws on failure, like utils/sms.js does, so issueOtp can report
 * `delivery_failed` and the caller can tell the person to try another way
 * rather than leaving them waiting for a message that was never sent.
 */
async function sendOtpEmail(address, code, purpose) {
  const { text, html } = body(code, purpose);

  if (!isConfigured()) {
    // Instead of sending, not as well as.
    console.log(`[DEV] OTP email to ${address} (${purpose}): ${code}`);
    return { devMode: true };
  }

  return getTransport().sendMail({
    from: FROM,
    to: address,
    subject: 'Your LindaCare verification code',
    text,
    html,
  });
}

/**
 * Check the transport at boot, without sending anything.
 *
 * Called from index.js so a broken SMTP configuration is found when the service
 * starts rather than by the first person who cannot get into their account.
 * Never throws: email being down must not stop a service whose main channel is
 * SMS.
 */
async function verifyTransport() {
  if (!isConfigured()) {
    return { ok: true, devMode: true };
  }
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendOtpEmail, verifyTransport, isConfigured };
