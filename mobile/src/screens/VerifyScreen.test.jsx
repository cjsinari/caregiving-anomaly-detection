import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import VerifyScreen from './VerifyScreen';
import { auth } from '../api/endpoints';
import { ApiError } from '../api/client';

/*
 * The code screen, which is the half of signing in that produces a session.
 *
 * The step-up path is the reason this file exists. A sign-in the risk engine
 * is unsure about comes back with a challenge instead of tokens, and a screen
 * that assumed tokens would sit there forever -- which is the sort of failure
 * that only shows up for the people whose sign-ins look unusual, which is
 * exactly who it must not fail for.
 */

jest.mock('../api/endpoints', () => ({
  auth: {
    verifyLogin: jest.fn(),
    verifyRegistration: jest.fn(),
    verifyStepUp: jest.fn(),
    requestOtp: jest.fn(),
  },
}));

jest.mock('../auth/session', () => ({
  getDeviceFingerprint: jest.fn(async () => 'device-under-test'),
}));

// Prefixed with `mock` because a jest.mock factory is not allowed to close
// over any other out-of-scope variable.
const mockSignIn = jest.fn();
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };

const SESSION = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 900,
  user: { id: 'u1', fullName: 'Jane Kamau', role: 'caregiver' },
};

let screen;

const renderScreen = async (params = {}) => {
  screen = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <VerifyScreen
        navigation={navigation}
        route={{ params: { phoneNumber: '+254712345678', purpose: 'login', ...params } }}
      />
    </SafeAreaProvider>
  );
  return screen;
};

const typeCode = async (code, label = 'Verification code') =>
  fireEvent.changeText(screen.getByLabelText(label), code);

const pressVerify = async (label = 'Verify') => fireEvent.press(screen.getByLabelText(label));

beforeEach(() => {
  jest.clearAllMocks();
  auth.verifyLogin.mockResolvedValue(SESSION);
  auth.verifyRegistration.mockResolvedValue(SESSION);
  auth.verifyStepUp.mockResolvedValue(SESSION);
  auth.requestOtp.mockResolvedValue({ message: 'sent' });
});

describe('verifying a sign-in', () => {
  it('sends the code with the device fingerprint and signs in', async () => {
    await renderScreen();
    await typeCode('123456');
    await pressVerify();

    await waitFor(() => expect(auth.verifyLogin).toHaveBeenCalledWith({
      phoneNumber: '+254712345678',
      otp: '123456',
      deviceFingerprint: 'device-under-test',
    }));
    // The tokens go to the provider, which swaps the navigator. No navigate
    // call here is the point: see RootNavigator.
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith(SESSION));
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('posts a registration code to the registration endpoint instead', async () => {
    await renderScreen({ purpose: 'registration', fullName: 'Jane Kamau' });
    await typeCode('123456');
    await pressVerify();

    await waitFor(() => expect(auth.verifyRegistration).toHaveBeenCalledTimes(1));
    expect(auth.verifyLogin).not.toHaveBeenCalled();
  });

  it('refuses a short code without calling the service', async () => {
    await renderScreen();
    await typeCode('123');
    await pressVerify();

    await waitFor(() => expect(screen.getByText('The code is 6 digits')).toBeTruthy());
    expect(auth.verifyLogin).not.toHaveBeenCalled();
  });

  it('keeps only the digits of a pasted code', async () => {
    await renderScreen();
    await typeCode('12-34 56');
    await pressVerify();

    await waitFor(() => expect(auth.verifyLogin).toHaveBeenCalledWith(
      expect.objectContaining({ otp: '123456' })));
  });
});

describe('the step-up challenge', () => {
  it('asks for a second code and answers it on the step-up endpoint', async () => {
    auth.verifyLogin.mockResolvedValue({
      status: 'step_up_required',
      challengeId: 'challenge-1',
      channel: 'sms',
      expiresIn: 300,
      message: "We don't recognise this device. We've sent a code to verify it's you.",
      riskScore: 62,
    });

    await renderScreen();
    await typeCode('123456');
    await pressVerify();

    // The screen changes what it is asking for rather than pushing a second
    // near-identical screen that leaves a spent code behind the back gesture.
    await waitFor(() => expect(screen.getByText('One more check')).toBeTruthy());
    expect(screen.getByText(/don't recognise this device/)).toBeTruthy();
    expect(mockSignIn).not.toHaveBeenCalled();

    await typeCode('654321', 'Security code');
    await pressVerify('Confirm & Sign In');

    await waitFor(() => expect(auth.verifyStepUp).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      otp: '654321',
      deviceFingerprint: 'device-under-test',
      // Trusting the device is what makes the challenge a one-off instead of
      // something the same person answers on the same phone every time.
      trustDevice: true,
    }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith(SESSION));
  });

  it('sends someone back to the start when the challenge expires', async () => {
    auth.verifyLogin.mockResolvedValue({
      status: 'step_up_required', challengeId: 'challenge-1', channel: 'sms',
    });
    auth.verifyStepUp.mockRejectedValue(new ApiError(
      'This verification has expired. Please sign in again.',
      { status: 401, code: 'CHALLENGE_EXPIRED' }));

    await renderScreen();
    await typeCode('123456');
    await pressVerify();
    await waitFor(() => expect(screen.getByText('One more check')).toBeTruthy());

    await typeCode('654321', 'Security code');
    await pressVerify('Confirm & Sign In');

    await waitFor(() => expect(screen.getByText('Verification expired')).toBeTruthy());
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

describe('when the code is wrong', () => {
  it('says how many attempts are left, under the input', async () => {
    // Five wrong codes locks the account. Someone who does not know that burns
    // all five on a code they misread from a notification.
    auth.verifyLogin.mockRejectedValue(new ApiError('Incorrect verification code.',
      { status: 401, code: 'OTP_INCORRECT', attemptsLeft: 3 }));

    await renderScreen();
    await typeCode('111111');
    await pressVerify();

    await waitFor(() => expect(screen.getByText('Incorrect code. 3 attempts left.')).toBeTruthy());
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('tells someone to ask for a new code when theirs has expired', async () => {
    auth.verifyLogin.mockRejectedValue(new ApiError('Invalid or expired verification code.',
      { status: 401, code: 'OTP_INVALID' }));

    await renderScreen();
    await typeCode('111111');
    await pressVerify();

    await waitFor(() =>
      expect(screen.getByText('That code is not valid any more. Ask for a new one.')).toBeTruthy());
  });

  it('stops accepting attempts once the account is locked', async () => {
    auth.verifyLogin.mockRejectedValue(new ApiError(
      'Too many incorrect codes. This account is locked for 15 minutes.',
      { status: 423, code: 'ACCOUNT_LOCKED', retryAfterSeconds: 900 }));

    await renderScreen();
    await typeCode('111111');
    await pressVerify();

    await waitFor(() => expect(screen.getByText('Account temporarily locked')).toBeTruthy());
    expect(screen.getByText(/15 minutes/)).toBeTruthy();
    // Further attempts would be refused by the service anyway, and letting
    // someone keep trying makes a lockout look like five more wrong answers.
    expect(screen.getByLabelText('Verify').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByLabelText('Back to sign in')).toBeTruthy();
  });
});

describe('resending', () => {
  it('holds the resend behind a countdown', async () => {
    await renderScreen();

    // A code was sent by the screen that navigated here, so the wait starts
    // immediately. Three taps while the first SMS is in transit is the
    // quickest route to a 429 that blocks the sign-in for fifteen minutes.
    const resend = screen.getByLabelText(/Resend code, available in/);
    expect(resend.props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(resend);
    expect(auth.requestOtp).not.toHaveBeenCalled();
  });
});
