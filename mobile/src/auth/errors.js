import { ApiError } from '../api/client';

/*
 * Turning a refusal from the service into something worth reading.
 *
 * Shared by the sign-in and verification screens so the same refusal does not
 * get two different wordings depending on which screen the person is standing
 * on.
 *
 * Every branch keys off `code`, never off the message text. The service owns
 * its wording and is free to reword it; a client that pattern-matched on
 * prose would break silently the first time it did.
 */

/** "15 minutes", "45 seconds" -- whichever reads more naturally. */
export function formatWait(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return null;
  if (total < 90) return `${total} second${total === 1 ? '' : 's'}`;
  const minutes = Math.ceil(total / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * A banner for an error the person cannot fix by editing a field.
 *
 * Returns `{ tone, title, message }`, or null when the error belongs under an
 * input instead -- a wrong code is a field error, not a banner.
 *
 * -- Why the rate limit and the lockout read differently --
 *
 * A 429 means too many codes were *requested*: nothing is wrong with the
 * account and the wait is the whole story. A 423 means too many codes were
 * entered *wrongly*, which locks the account, and someone seeing that without
 * having typed anything wrong is being told their number is under attack. The
 * second deserves more than "try later".
 */
export function bannerFor(err) {
  if (!(err instanceof ApiError)) {
    return { tone: 'error', title: 'Something went wrong', message: 'Please try again.' };
  }

  if (err.isNetwork) {
    return { tone: 'error', title: 'No connection', message: err.message };
  }

  const wait = formatWait(err.retryAfterSeconds);

  switch (err.code) {
    case 'OTP_RATE_LIMITED':
      return {
        tone: 'warning',
        title: 'Too many codes requested',
        message: wait
          ? `Please wait ${wait} before asking for another code.`
          : 'Please wait a few minutes before asking for another code.',
      };

    case 'ACCOUNT_LOCKED':
      return {
        tone: 'warning',
        title: 'Account temporarily locked',
        message: wait
          ? `Too many incorrect codes. Try again in ${wait}. If this was not you, contact support.`
          : 'Too many incorrect codes. Try again shortly. If this was not you, contact support.',
      };

    case 'OTP_DELIVERY_FAILED':
      return {
        tone: 'error',
        title: 'We could not send the SMS',
        message: 'Check the number and try again in a moment.',
      };

    case 'ACCOUNT_FROZEN':
    case 'ACCOUNT_SUSPENDED':
    case 'ACCOUNT_RESTRICTED':
      return { tone: 'error', title: 'Account unavailable', message: err.message };

    /*
     * The risk engine refused the sign-in outright. `explanation` is the
     * sentence the service generated for the audit trail, written to be read
     * by a person, so it is shown rather than replaced with something vaguer.
     */
    case 'LOGIN_BLOCKED':
      return { tone: 'error', title: 'Sign-in blocked', message: err.message };

    case 'CHALLENGE_EXPIRED':
      return {
        tone: 'warning',
        title: 'Verification expired',
        message: 'That took too long. Please start signing in again.',
      };

    case 'SESSION_FLAGGED':
      return { tone: 'warning', title: 'Session ended', message: err.message };

    // A wrong or expired code belongs under the input, not in a banner.
    case 'OTP_INCORRECT':
    case 'OTP_INVALID':
      return null;

    default:
      // A 429 with no code of its own is the per-IP limiter in index.js rather
      // than the OTP budget. Same advice, different cause.
      if (err.status === 429) {
        return {
          tone: 'warning',
          title: 'Too many attempts',
          message: wait ? `Please try again in ${wait}.` : 'Please try again in a few minutes.',
        };
      }
      return { tone: 'error', title: 'Something went wrong', message: err.message };
  }
}

/**
 * The message that goes under the code input.
 *
 * The service counts down the attempts left before the account locks, and
 * saying so is what stops someone burning all five on a code they misread
 * from a notification they could have reopened.
 */
export function otpFieldError(err) {
  if (!(err instanceof ApiError)) return null;
  if (err.code === 'OTP_INCORRECT') {
    const left = Number(err.attemptsLeft);
    return Number.isFinite(left) && left > 0
      ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`
      : 'Incorrect code.';
  }
  if (err.code === 'OTP_INVALID') {
    return 'That code is not valid any more. Ask for a new one.';
  }
  return null;
}
