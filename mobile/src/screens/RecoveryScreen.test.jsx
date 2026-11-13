import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RecoveryScreen from './RecoveryScreen';
import { auth } from '../api/endpoints';
import { ApiError } from '../api/client';

/*
 * The recovery request screen.
 *
 * The property that matters most here is the one that is easiest to break by
 * being helpful: nothing on this screen may behave differently for a contact
 * that exists. The service answers identically either way, and the screen has
 * to be just as incurious — same navigation, same words, same timing.
 */

jest.mock('../api/endpoints', () => ({
  auth: { requestRecovery: jest.fn() },
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };

let screen;

const renderScreen = async () => {
  screen = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <RecoveryScreen navigation={navigation} />
    </SafeAreaProvider>
  );
  return screen;
};

const type = async (value) =>
  fireEvent.changeText(screen.getByLabelText('Email or phone number'), value);

const submit = async () => fireEvent.press(screen.getByLabelText('Send Recovery Code'));

beforeEach(() => {
  jest.clearAllMocks();
  auth.requestRecovery.mockResolvedValue({
    message: 'If this account exists, we have sent a verification code to that email address.',
    channel: 'email',
  });
});

describe('what it accepts', () => {
  it('refuses an empty field', async () => {
    await renderScreen();
    await submit();

    await waitFor(() =>
      expect(screen.getByText('Enter your email address or phone number')).toBeTruthy());
    expect(auth.requestRecovery).not.toHaveBeenCalled();
  });

  it('refuses something that is neither', async () => {
    await renderScreen();
    await type('jane');
    await submit();

    await waitFor(() => expect(screen.getByText(/Enter a valid phone number/)).toBeTruthy());
    expect(auth.requestRecovery).not.toHaveBeenCalled();
  });

  it('refuses a malformed email', async () => {
    await renderScreen();
    await type('jane@');
    await submit();

    await waitFor(() => expect(screen.getByText('Enter a valid email address')).toBeTruthy());
  });

  it('tells a diaspora user to include their country code', async () => {
    /*
     * The service assumes a bare local number is Kenyan, so 07700 900123
     * cannot be resolved at all. Without this message a family member in the
     * UK is told their own number is invalid and has no idea why.
     */
    await renderScreen();
    await type('07700900123');
    await submit();

    await waitFor(() => expect(screen.getByText(/include the country code/)).toBeTruthy());
    expect(auth.requestRecovery).not.toHaveBeenCalled();
  });
});

describe('sending the code', () => {
  it('lowercases an email, because the service matches case-insensitively', async () => {
    await renderScreen();
    await type('  Jane.Backup@Example.COM ');
    await submit();

    await waitFor(() =>
      expect(auth.requestRecovery).toHaveBeenCalledWith('jane.backup@example.com'));
  });

  it('normalises a Kenyan number to E.164 before sending it', async () => {
    auth.requestRecovery.mockResolvedValue({ message: 'sent', channel: 'sms' });

    await renderScreen();
    await type('0712 345 678');
    await submit();

    await waitFor(() => expect(auth.requestRecovery).toHaveBeenCalledWith('+254712345678'));
  });

  it('accepts a foreign number given its country code', async () => {
    auth.requestRecovery.mockResolvedValue({ message: 'sent', channel: 'sms' });

    await renderScreen();
    await type('+44 7700 900123');
    await submit();

    await waitFor(() => expect(auth.requestRecovery).toHaveBeenCalledWith('+447700900123'));
  });

  it('carries the contact and channel to the code screen', async () => {
    await renderScreen();
    await type('jane@example.com');
    await submit();

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Verify', {
      contact: 'jane@example.com',
      purpose: 'recovery',
      channel: 'email',
    }));
  });

  it('falls back to deriving the channel if the service sends none', async () => {
    auth.requestRecovery.mockResolvedValue({ message: 'sent' });

    await renderScreen();
    await type('0712345678');
    await submit();

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Verify',
      expect.objectContaining({ channel: 'sms' })));
  });
});

describe('not revealing whether an account exists', () => {
  it('moves on identically for a contact with no account', async () => {
    /*
     * The service cannot say, so neither can this screen. A different route,
     * a different message, or a visible failure here would answer the question
     * the generic response exists to refuse.
     */
    auth.requestRecovery.mockResolvedValue({
      message: 'If this account exists, we have sent a verification code to that email address.',
      channel: 'email',
    });

    await renderScreen();
    await type('nobody@example.com');
    await submit();

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Verify', {
      contact: 'nobody@example.com',
      purpose: 'recovery',
      channel: 'email',
    }));
    // No "account not found", no error tone, nothing to tell the two apart.
    expect(screen.queryByText(/not found/i)).toBeNull();
    expect(screen.queryByText(/no account/i)).toBeNull();
  });
});

describe('when the request itself fails', () => {
  it('reports a dead network without moving on', async () => {
    auth.requestRecovery.mockRejectedValue(new ApiError(
      'Could not reach LindaCare. Check your connection and try again.', { code: 'NETWORK' }));

    await renderScreen();
    await type('jane@example.com');
    await submit();

    await waitFor(() => expect(screen.getByText('No connection')).toBeTruthy());
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('explains a per-device rate limit', async () => {
    // The per-IP limiter in index.js, which is not account-specific and so
    // says nothing about whether the contact is registered.
    auth.requestRecovery.mockRejectedValue(new ApiError(
      'Too many requests from this device. Please try again later.', { status: 429 }));

    await renderScreen();
    await type('jane@example.com');
    await submit();

    await waitFor(() => expect(screen.getByText('Too many attempts')).toBeTruthy());
  });
});
