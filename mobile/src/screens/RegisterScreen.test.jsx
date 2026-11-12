import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RegisterScreen from './RegisterScreen';
import { auth } from '../api/endpoints';
import { ApiError } from '../api/client';

/*
 * A smoke test for the registration screen.
 *
 * The exhaustive component pass belongs to issue #47. This covers the five
 * things that would make the screen wrong rather than merely ugly: the two
 * roles ask for different fields, switching role keeps what the person
 * already typed, a refusal from the service lands on the field that caused
 * it, a second tap cannot start a second registration, and a successful
 * registration hands off to verification with the number the service was
 * actually given.
 *
 * ── Why everything is awaited ──
 *
 * React Native Testing Library 14 made `render` and every `fireEvent` method
 * async; they return promises that resolve once React has flushed. Calling
 * them without awaiting appears to work and then asserts against the frame
 * before the one you meant, so each interaction is awaited individually.
 */

jest.mock('../api/endpoints', () => ({
  auth: { register: jest.fn() },
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false };

/*
 * The queries for the screen under test.
 *
 * The object `render` resolves to, rather than the library's `screen`
 * singleton: that singleton is a live binding which Babel's CJS interop
 * snapshots at import time, so it stays unbound here however many times
 * render is called.
 */
let screen;

const renderScreen = async () => {
  screen = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <RegisterScreen navigation={navigation} />
    </SafeAreaProvider>
  );
  return screen;
};

beforeEach(() => {
  jest.clearAllMocks();
  auth.register.mockResolvedValue({ message: 'Verification code sent.' });
});

/** Fill the free-text fields the caregiver form needs. */
const fillCaregiverText = async () => {
  await fireEvent.changeText(screen.getByLabelText('Full name'), 'Jane Kamau');
  await fireEvent.changeText(screen.getByLabelText(/Phone number, country code/), '712345678');
  await fireEvent.changeText(screen.getByLabelText('National ID number'), '32847291');
};

/*
 * Open a SelectField's sheet and choose an option out of it.
 *
 * Searches first when the sheet offers a search box, which is both what a
 * person would do with 47 counties and what the test has to do: FlatList
 * renders only its first batch, so an option far down the list genuinely is
 * not on screen until it is filtered to.
 */
const pickFromSelect = async (label, option) => {
  await fireEvent.press(screen.getByLabelText(label));
  const search = screen.queryByLabelText(`Search ${label}`);
  if (search) await fireEvent.changeText(search, option);
  await fireEvent.press(screen.getByText(option));
};

const agreeAndSubmit = async (buttonLabel = 'Register & Verify Identity') => {
  await fireEvent.press(screen.getByLabelText(/I agree to LindaCare/));
  await fireEvent.press(screen.getByLabelText(buttonLabel));
};

describe('role selection', () => {
  it('opens on the caregiver form', async () => {
    await renderScreen();
    expect(screen.getByLabelText('National ID number')).toBeTruthy();
    expect(screen.queryByLabelText('Country of residence')).toBeNull();
  });

  it('asks a family member for a country, a relationship and a name instead', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Family Member'));

    expect(screen.queryByLabelText('National ID number')).toBeNull();
    expect(screen.getByLabelText('Country of residence')).toBeTruthy();
    expect(screen.getByLabelText('Relationship to family member')).toBeTruthy();
    expect(screen.getByLabelText("Family member's name")).toBeTruthy();
  });

  it('keeps the name and number already typed when the role changes', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByLabelText('Full name'), 'Jane Kamau');
    await fireEvent.changeText(screen.getByLabelText(/Phone number, country code/), '712345678');

    await fireEvent.press(screen.getByLabelText('Family Member'));

    expect(screen.getByLabelText('Full name').props.value).toBe('Jane Kamau');
    // The field groups digits for display; the grouping is cosmetic.
    expect(screen.getByLabelText(/Phone number, country code/).props.value).toBe('712 345 678');
  });
});

describe('validation before anything is sent', () => {
  it('refuses an empty form and does not call the service', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Register & Verify Identity'));

    await waitFor(() => expect(screen.getByText('Enter your full name')).toBeTruthy());
    expect(screen.getByText('Enter your national ID number')).toBeTruthy();
    expect(screen.getByText('You need to agree before we can create your account')).toBeTruthy();
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('refuses a landline, which would never receive the code', async () => {
    await renderScreen();
    await fillCaregiverText();
    await fireEvent.changeText(screen.getByLabelText(/Phone number, country code/), '202345678');
    await fireEvent.press(screen.getByLabelText('Register & Verify Identity'));

    await waitFor(() =>
      expect(screen.getByText('Enter a Kenyan mobile number, e.g. 0712 345 678')).toBeTruthy());
    expect(auth.register).not.toHaveBeenCalled();
  });
});

describe('submitting', () => {
  it('sends the caregiver payload the service expects and moves to verification', async () => {
    await renderScreen();
    await fillCaregiverText();
    await pickFromSelect('County', 'Nairobi');
    await agreeAndSubmit();

    await waitFor(() => expect(auth.register).toHaveBeenCalledTimes(1));
    expect(auth.register).toHaveBeenCalledWith({
      phoneNumber: '+254712345678',
      fullName: 'Jane Kamau',
      consent: true,
      role: 'caregiver',
      nationalId: '32847291',
      county: 'Nairobi',
      countryCode: 'KE',
    });

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith('Verify',
      expect.objectContaining({ phoneNumber: '+254712345678', role: 'caregiver' })));
  });

  it('puts a duplicate national ID under the national ID field', async () => {
    auth.register.mockRejectedValue(new ApiError(
      'This national ID is already registered to another caregiver. Please contact support.',
      { status: 409, code: 'NATIONAL_ID_IN_USE' }));

    await renderScreen();
    await fillCaregiverText();
    await pickFromSelect('County', 'Nairobi');
    await agreeAndSubmit();

    await waitFor(() => expect(screen.getByText('This ID is already registered')).toBeTruthy());
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('maps a field-level 400 from the service onto the right input', async () => {
    auth.register.mockRejectedValue(new ApiError('Invalid input', {
      status: 400,
      details: [{ field: 'phoneNumber', message: 'Invalid phone number' }],
    }));

    await renderScreen();
    await fillCaregiverText();
    await pickFromSelect('County', 'Nairobi');
    await agreeAndSubmit();

    // phoneNumber has no input of its own; it has to land on localNumber.
    await waitFor(() => expect(screen.getByText('Invalid phone number')).toBeTruthy());
  });

  it('reports a network failure without blaming the input', async () => {
    auth.register.mockRejectedValue(new ApiError(
      'Could not reach LindaCare. Check your connection and try again.', { code: 'NETWORK' }));

    await renderScreen();
    await fillCaregiverText();
    await pickFromSelect('County', 'Nairobi');
    await agreeAndSubmit();

    await waitFor(() => expect(
      screen.getByText('Could not reach LindaCare. Check your connection and try again.')
    ).toBeTruthy());
  });

  it('does not start a second registration while one is in flight', async () => {
    let release;
    auth.register.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    await renderScreen();
    await fillCaregiverText();
    await pickFromSelect('County', 'Nairobi');
    await fireEvent.press(screen.getByLabelText(/I agree to LindaCare/));

    // Deliberately not awaited: the service call is held open below, so the
    // press never settles and awaiting it would deadlock the test rather
    // than test anything.
    fireEvent.press(screen.getByLabelText('Register & Verify Identity'));
    await waitFor(() => expect(auth.register).toHaveBeenCalledTimes(1));

    // While the request is open the button renames itself and reports busy,
    // so a screen reader says "in progress" rather than "dimmed".
    const busy = screen.getByLabelText(/Sending code/);
    expect(busy.props.accessibilityState).toMatchObject({ busy: true, disabled: true });

    // A second tap during the request would mean a second SMS and a consumed
    // rate limit on the service's OTP endpoint.
    fireEvent.press(busy);
    fireEvent.press(busy);
    expect(auth.register).toHaveBeenCalledTimes(1);

    release({ message: 'ok' });
    await waitFor(() => expect(navigation.navigate).toHaveBeenCalled());
  });
});

describe('the family form', () => {
  it('drops the county when the person lives abroad', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Family Member'));

    await fireEvent.changeText(screen.getByLabelText('Full name'), 'Peter Omondi');
    await fireEvent.changeText(screen.getByLabelText(/Phone number, country code/), '722000111');
    await pickFromSelect('Country of residence', 'United Kingdom');
    await pickFromSelect('Relationship to family member', 'Father / Mother');
    await fireEvent.changeText(screen.getByLabelText("Family member's name"), 'Mary Omondi');
    await agreeAndSubmit('Register & Verify Number');

    await waitFor(() => expect(auth.register).toHaveBeenCalledTimes(1));
    const payload = auth.register.mock.calls[0][0];
    expect(payload).not.toHaveProperty('county');
    expect(payload.countryCode).toBe('GB');
    expect(payload.relationshipToRecipient).toBe('parent');
    expect(payload.careRecipientName).toBe('Mary Omondi');
  });

  it('hides the county field once the country is not Kenya', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByLabelText('Family Member'));
    expect(screen.getByLabelText('County')).toBeTruthy();

    await pickFromSelect('Country of residence', 'United Kingdom');
    expect(screen.queryByLabelText('County')).toBeNull();
  });
});
