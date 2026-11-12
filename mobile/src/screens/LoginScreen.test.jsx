import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import LoginScreen from './LoginScreen';
import { auth } from '../api/endpoints';
import { ApiError } from '../api/client';

/*
 * The sign-in screen.
 *
 * Small screen, four things worth holding still: a number that cannot receive
 * an SMS never reaches the service, the number that does reach it is in E.164,
 * a rate limit is explained rather than swallowed, and a diaspora family
 * member can sign in with their own country's number.
 *
 * Everything is awaited: React Native Testing Library 14 made `render` and
 * every `fireEvent` method async, and not awaiting them asserts against the
 * frame before the one you meant.
 */

jest.mock('../api/endpoints', () => ({
  auth: { requestOtp: jest.fn() },
}));

const mockAuth = { notice: null, dismissNotice: jest.fn() };
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false };

let screen;

const renderScreen = async () => {
  screen = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <LoginScreen navigation={navigation} />
    </SafeAreaProvider>
  );
  return screen;
};

const typeNumber = async (digits) =>
  fireEvent.changeText(screen.getByLabelText(/Phone number, country code/), digits);

const submit = async () => fireEvent.press(screen.getByLabelText('Send Code'));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.notice = null;
  auth.requestOtp.mockResolvedValue({ message: 'If this number is registered, a verification code has been sent.' });
});

describe('before anything is sent', () => {
  it('refuses an empty number', async () => {
    await renderScreen();
    await submit();

    await waitFor(() => expect(screen.getByText('Enter your phone number')).toBeTruthy());
    expect(auth.requestOtp).not.toHaveBeenCalled();
  });

  it('refuses a landline, which would never receive the code', async () => {
    await renderScreen();
    await typeNumber('202345678');
    await submit();

    await waitFor(() =>
      expect(screen.getByText('Enter a Kenyan mobile number, e.g. 0712 345 678')).toBeTruthy());
    expect(auth.requestOtp).not.toHaveBeenCalled();
  });
});

describe('requesting a code', () => {
  it('sends the number in E.164 and moves to the code screen', async () => {
    await renderScreen();
    // Typed the way a Kenyan writes their own number, with the national zero.
    await typeNumber('0712345678');
    await submit();

    await waitFor(() => expect(auth.requestOtp).toHaveBeenCalledWith('+254712345678', 'login'));
    expect(navigation.navigate).toHaveBeenCalledWith('Verify', {
      phoneNumber: '+254712345678',
      purpose: 'login',
    });
  });

  it('lets a family member abroad sign in with their own number', async () => {
    await renderScreen();

    // The dial code is a picker here, unlike the caregiver registration form.
    await fireEvent.press(screen.getByLabelText('Country dialling code'));
    await fireEvent.changeText(screen.getByLabelText('Search dialling codes'), '+44');
    await fireEvent.press(screen.getByText(/^\+44/));

    await typeNumber('7700900123');
    await submit();

    // The Kenyan-mobile rule must not apply to a +44 number, or someone who
    // registered from abroad could never sign in again.
    await waitFor(() => expect(auth.requestOtp).toHaveBeenCalledWith('+447700900123', 'login'));
  });
});

describe('when the service refuses', () => {
  it('explains a rate limit with the wait, and does not move on', async () => {
    auth.requestOtp.mockRejectedValue(new ApiError(
      'Too many verification codes requested. Please try again in 15 minutes.',
      { status: 429, code: 'OTP_RATE_LIMITED', retryAfterSeconds: 900 }));

    await renderScreen();
    await typeNumber('712345678');
    await submit();

    await waitFor(() => expect(screen.getByText('Too many codes requested')).toBeTruthy());
    expect(screen.getByText(/15 minutes/)).toBeTruthy();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('names a frozen account instead of blaming the number', async () => {
    auth.requestOtp.mockRejectedValue(new ApiError(
      'This account is frozen. Please contact support.',
      { status: 403, code: 'ACCOUNT_FROZEN' }));

    await renderScreen();
    await typeNumber('712345678');
    await submit();

    await waitFor(() => expect(screen.getByText('Account unavailable')).toBeTruthy());
    expect(screen.getByText('This account is frozen. Please contact support.')).toBeTruthy();
  });

  it('reports a dead network without blaming the input', async () => {
    auth.requestOtp.mockRejectedValue(new ApiError(
      'Could not reach LindaCare. Check your connection and try again.', { code: 'NETWORK' }));

    await renderScreen();
    await typeNumber('712345678');
    await submit();

    await waitFor(() => expect(screen.getByText('No connection')).toBeTruthy());
  });
});

describe('arriving here after being signed out', () => {
  it('says why, rather than looking like a crash', async () => {
    mockAuth.notice = 'We ended your session because of unusual activity on your account. Please sign in again.';

    await renderScreen();

    expect(screen.getByText('You were signed out')).toBeTruthy();
    expect(screen.getByText(/unusual activity/)).toBeTruthy();
  });
});
