import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AccountScreen from './AccountScreen';
import ProfileScreen from './ProfileScreen';
import ChangePhoneScreen from './ChangePhoneScreen';
import { AccountProvider } from '../../account/AccountContext';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { CAREGIVER_PORTAL, FAMILY_PORTAL } from '../../navigation/portals';
import { account, auth } from '../../api/endpoints';
import { ApiError } from '../../api/client';

/*
 * Issue #46: the profile (item 2) and settings (item 3) screens, and the
 * phone change that stands in for the password change this app has no
 * password for.
 */

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED: 'whenUnlocked',
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => { store.set(k, v); }),
    deleteItemAsync: jest.fn(async (k) => { store.delete(k); }),
    __store: store,
  };
});

jest.mock('../../api/endpoints', () => ({
  auth: { me: jest.fn() },
  account: {
    getPreferences: jest.fn(),
    updatePreferences: jest.fn(),
    registerPushToken: jest.fn(),
    unregisterPushToken: jest.fn(),
    updateProfile: jest.fn(),
    requestPhoneChange: jest.fn(),
    verifyPhoneChange: jest.fn(),
  },
}));

const mockAuth = {
  user: null,
  role: 'family',
  signOut: jest.fn(),
  updateUser: jest.fn(),
};
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => mockAuth }));

const SecureStore = require('expo-secure-store');
const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };

const FAMILY_PREFS = {
  push: true,
  categories: [
    { key: 'visit', label: 'Completed visits', hint: 'A message each time a visit report is filed', enabled: true },
    { key: 'note', label: 'Care notes', hint: 'Notes the care team writes between visits', enabled: true },
    { key: 'schedule', label: 'Schedule changes', hint: 'Visits added, moved or cancelled', enabled: true },
  ],
  alwaysOn: ['incident', 'account'],
};

/*
 * `generation` keys the root: changing it unmounts everything and mounts it
 * fresh, which is a relaunch as far as React is concerned -- the keychain mock
 * is all that survives. (Unmounting by hand leaves the test renderer unable to
 * mount the next test's tree; see CarePlanScreen.test.jsx.)
 */
const tree = (Screen, portal, generation = 0) => (
  <SafeAreaProvider
    key={generation}
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <AccountProvider>
      <PortalChromeProvider portal={portal}>
        <Screen navigation={navigation} />
      </PortalChromeProvider>
    </AccountProvider>
  </SafeAreaProvider>
);

const launch = async (Screen, portal = FAMILY_PORTAL) => render(tree(Screen, portal));

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.__store.clear();
  Device.isDevice = false;
  Object.values(account).forEach((fn) => fn.mockReset());
  mockAuth.user = {
    id: 'user-1', fullName: 'Peter Wanjiku', role: 'family',
    phoneNumber: '+254700000101', email: 'peter@example.com',
  };
  mockAuth.role = 'family';
  mockAuth.updateUser = jest.fn(async (patch) => { mockAuth.user = { ...mockAuth.user, ...patch }; });
  auth.me.mockResolvedValue(mockAuth.user);
  account.getPreferences.mockResolvedValue({ preferences: FAMILY_PREFS });
  account.updatePreferences.mockImplementation(async ({ categories = {}, push }) => ({
    preferences: {
      ...FAMILY_PREFS,
      ...(push !== undefined && { push }),
      categories: FAMILY_PREFS.categories.map((c) => (
        c.key in categories ? { ...c, enabled: categories[c.key] } : c)),
    },
  }));
});

/* ─────────────────────────── Account ─────────────────────────── */

describe('the account screen', () => {
  it('shows who is signed in and opens the profile', async () => {
    await launch(AccountScreen);

    // Twice on a wide layout: here, and in the sidebar's account row.
    await waitFor(() => expect(screen.getAllByText('Peter Wanjiku').length).toBeGreaterThan(0));
    expect(screen.getByText('+254700000101')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Peter Wanjiku\./));
    expect(navigation.navigate).toHaveBeenCalledWith('Profile');
  });

  it('shows the role’s categories, as the service lists them', async () => {
    await launch(AccountScreen);

    await waitFor(() => expect(screen.getByLabelText('Completed visits')).toBeTruthy());
    expect(screen.getByLabelText('Care notes')).toBeTruthy();
    // Never offered as a switch: the service does not list them.
    expect(screen.queryByLabelText('Incidents')).toBeNull();
    expect(screen.getByText(/Incidents and account security alerts always reach you/)).toBeTruthy();
  });

  it('saves a category switch to the service', async () => {
    await launch(AccountScreen);
    await waitFor(() => expect(screen.getByLabelText('Completed visits')).toBeTruthy());

    await fireEvent(screen.getByLabelText('Completed visits'), 'valueChange', false);

    await waitFor(() => expect(account.updatePreferences).toHaveBeenCalledWith({ categories: { visit: false } }));
    expect(screen.getByLabelText('Completed visits').props.value).toBe(false);
  });

  it('puts the switch back, and says so, when the service refuses', async () => {
    account.updatePreferences.mockRejectedValueOnce(new Error('Could not reach LindaCare.'));
    await launch(AccountScreen);
    await waitFor(() => expect(screen.getByLabelText('Care notes')).toBeTruthy());

    await fireEvent(screen.getByLabelText('Care notes'), 'valueChange', false);

    await waitFor(() => expect(screen.getByText('Could not reach LindaCare.')).toBeTruthy());
    expect(screen.getByLabelText('Care notes').props.value).toBe(true);
  });

  it('keeps the choices for a launch with no signal', async () => {
    const first = await launch(AccountScreen);
    await waitFor(() => expect(screen.getByLabelText('Completed visits')).toBeTruthy());
    await fireEvent(screen.getByLabelText('Completed visits'), 'valueChange', false);
    await waitFor(() => expect(account.updatePreferences).toHaveBeenCalled());

    account.getPreferences.mockRejectedValue(new ApiError('offline', { code: 'NETWORK' }));
    await first.rerender(tree(AccountScreen, FAMILY_PORTAL, 1));

    await waitFor(() => expect(screen.getByLabelText('Completed visits').props.value).toBe(false));
  });

  it('a caregiver sees a caregiver’s categories, and no incident line', async () => {
    mockAuth.role = 'caregiver';
    account.getPreferences.mockResolvedValue({
      preferences: {
        push: true,
        categories: [{ key: 'assignments', label: 'Assignment changes', hint: '', enabled: true }],
        alwaysOn: ['account'],
      },
    });
    await launch(AccountScreen, CAREGIVER_PORTAL);

    await waitFor(() => expect(screen.getByLabelText('Assignment changes')).toBeTruthy());
    expect(screen.queryByLabelText('Completed visits')).toBeNull();
    expect(screen.getByText('Account security alerts always reach you and cannot be switched off.')).toBeTruthy();
  });
});

describe('push notifications', () => {
  it('says plainly that an emulator cannot receive them', async () => {
    await launch(AccountScreen);
    await waitFor(() => expect(screen.getByText(/Not available on an emulator/)).toBeTruthy());
    expect(screen.getByLabelText('Push notifications').props.disabled).toBe(true);
  });

  it('registers this phone with the service on a real device', async () => {
    Device.isDevice = true;
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    account.registerPushToken.mockResolvedValue({ registered: true });

    await launch(AccountScreen);

    await waitFor(() => expect(account.registerPushToken).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('On for this phone.')).toBeTruthy());
  });

  it('points to the phone’s own settings after a no', async () => {
    Device.isDevice = true;
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

    await launch(AccountScreen);

    await waitFor(() => expect(screen.getByText(/Blocked in your phone’s settings/)).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Open phone settings'));
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('switching off forgets this phone and tells the service', async () => {
    Device.isDevice = true;
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    account.registerPushToken.mockResolvedValue({ registered: true });
    await launch(AccountScreen);
    await waitFor(() => expect(screen.getByText('On for this phone.')).toBeTruthy());

    await fireEvent(screen.getByLabelText('Push notifications'), 'valueChange', false);

    await waitFor(() => expect(account.updatePreferences).toHaveBeenCalledWith({ push: false }));
    expect(account.unregisterPushToken).toHaveBeenCalled();
  });
});

describe('about and signing out', () => {
  it('shows the app version', async () => {
    await launch(AccountScreen);
    await waitFor(() => expect(screen.getByLabelText(/^App version: /)).toBeTruthy());
  });

  it('asks before signing out, and can be talked out of it', async () => {
    await launch(AccountScreen);
    await waitFor(() => expect(screen.getByLabelText('Sign out')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Sign out'));
    expect(screen.getByText('Sign out of LindaCare on this phone?')).toBeTruthy();
    expect(mockAuth.signOut).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText('Stay signed in'));
    expect(screen.queryByText('Sign out of LindaCare on this phone?')).toBeNull();
  });

  it('signs out when confirmed', async () => {
    mockAuth.signOut.mockResolvedValue(undefined);
    await launch(AccountScreen);
    await waitFor(() => expect(screen.getByLabelText('Sign out')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Sign out'));
    await fireEvent.press(screen.getAllByLabelText('Sign out')[0]);

    await waitFor(() => expect(mockAuth.signOut).toHaveBeenCalled());
  });
});

/* ─────────────────────────── Profile ─────────────────────────── */

describe('the profile screen', () => {
  it('saves a new name to the service and to the session', async () => {
    account.updateProfile.mockResolvedValue({ user: { ...mockAuth.user, fullName: 'Peter Kamau Wanjiku' } });
    await launch(ProfileScreen);

    await fireEvent.changeText(screen.getByLabelText('Full name'), '  Peter Kamau Wanjiku ');
    await fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(account.updateProfile).toHaveBeenCalledWith({ fullName: 'Peter Kamau Wanjiku' }));
    expect(mockAuth.updateUser).toHaveBeenCalledWith({ fullName: 'Peter Kamau Wanjiku' });
    await waitFor(() => expect(screen.getByText('Saved. Your care team will see this name.')).toBeTruthy());
  });

  it('refuses a name registration would refuse', async () => {
    await launch(ProfileScreen);

    await fireEvent.changeText(screen.getByLabelText('Full name'), 'P');
    await fireEvent.press(screen.getByLabelText('Save'));

    expect(screen.getByText('Enter your full name')).toBeTruthy();
    expect(account.updateProfile).not.toHaveBeenCalled();
  });

  it('shows the phone number as a fact with its own way to change it', async () => {
    await launch(ProfileScreen);

    expect(screen.getByText('+254700000101')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Change phone number'));
    expect(navigation.navigate).toHaveBeenCalledWith('ChangePhone');
  });

  it('offers no password to change, because there is none', async () => {
    await launch(ProfileScreen);
    expect(screen.queryByText(/password/i)).toBeNull();
  });
});

/* ─────────────────────────── Change phone ─────────────────────────── */

describe('changing the phone number', () => {
  const start = async () => {
    account.requestPhoneChange.mockResolvedValue({
      currentNumber: '+2547****0101', newNumber: '+2547****0202',
    });
    await launch(ChangePhoneScreen);
    await fireEvent.changeText(screen.getByLabelText(/New phone number, country code/), '0700000202');
    await fireEvent.press(screen.getByLabelText('Send codes'));
    await waitFor(() => expect(screen.getByText('Enter Both Codes')).toBeTruthy());
  };

  it('refuses a landline before asking the service', async () => {
    await launch(ChangePhoneScreen);
    await fireEvent.changeText(screen.getByLabelText(/New phone number, country code/), '0202345678');
    await fireEvent.press(screen.getByLabelText('Send codes'));

    expect(screen.getByText(/Enter a Kenyan mobile number/)).toBeTruthy();
    expect(account.requestPhoneChange).not.toHaveBeenCalled();
  });

  it('puts a number already in use under the field', async () => {
    account.requestPhoneChange.mockRejectedValue(new ApiError('That number is already used by another account.',
      { status: 409, code: 'PHONE_IN_USE', details: [{ field: 'phoneNumber', message: 'Already used' }] }));
    await launch(ChangePhoneScreen);
    await fireEvent.changeText(screen.getByLabelText(/New phone number, country code/), '0700000202');
    await fireEvent.press(screen.getByLabelText('Send codes'));

    await waitFor(() => expect(screen.getByText('That number is already used by another account.')).toBeTruthy());
  });

  it('asks for two codes, each labelled with the phone it went to', async () => {
    await start();

    expect(account.requestPhoneChange).toHaveBeenCalledWith('+254700000202');
    expect(screen.getByLabelText('Code sent to your current number +2547****0101')).toBeTruthy();
    expect(screen.getByLabelText('Code sent to your new number +2547****0202')).toBeTruthy();
  });

  it('puts a wrong code under the box it belongs to, with the tries left', async () => {
    await start();
    account.verifyPhoneChange.mockRejectedValue(new ApiError('The code from your current number is not right.', {
      status: 422, code: 'OTP_INCORRECT', attemptsLeft: 4,
      details: [{ field: 'currentCode', message: 'Incorrect code' }],
    }));

    await fireEvent.changeText(screen.getByLabelText('Code sent to your current number +2547****0101'), '111111');
    await fireEvent.changeText(screen.getByLabelText('Code sent to your new number +2547****0202'), '222222');
    await fireEvent.press(screen.getByLabelText('Change number'));

    await waitFor(() => expect(
      screen.getByText('The code from your current number is not right. 4 tries left.')
    ).toBeTruthy());
    // The provider refreshes the profile on mount, so updateUser has run --
    // but never with the number that was not confirmed.
    expect(mockAuth.updateUser).not.toHaveBeenCalledWith({ phoneNumber: '+254700000202' });
  });

  it('starts again, saying why, when the codes are used up', async () => {
    await start();
    account.verifyPhoneChange.mockRejectedValue(new ApiError('Too many incorrect codes.', {
      status: 429, code: 'OTP_EXHAUSTED', details: [{ field: 'newCode', message: 'Too many attempts' }],
    }));

    await fireEvent.changeText(screen.getByLabelText('Code sent to your current number +2547****0101'), '111111');
    await fireEvent.changeText(screen.getByLabelText('Code sent to your new number +2547****0202'), '222222');
    await fireEvent.press(screen.getByLabelText('Change number'));

    await waitFor(() => expect(screen.getByText(/Request new codes to try again/)).toBeTruthy());
    expect(screen.getByLabelText('Send codes')).toBeTruthy();
  });

  it('changes the number, remembers it, and says other devices were signed out', async () => {
    await start();
    account.verifyPhoneChange.mockResolvedValue({
      user: { ...mockAuth.user, phoneNumber: '+254700000202' }, sessionsEnded: 1,
    });

    await fireEvent.changeText(screen.getByLabelText('Code sent to your current number +2547****0101'), '123456');
    await fireEvent.changeText(screen.getByLabelText('Code sent to your new number +2547****0202'), '654321');
    await fireEvent.press(screen.getByLabelText('Change number'));

    await waitFor(() => expect(screen.getByText('Your number is now +254700000202')).toBeTruthy());
    expect(account.verifyPhoneChange).toHaveBeenCalledWith({
      phoneNumber: '+254700000202', currentCode: '123456', newCode: '654321',
    });
    expect(mockAuth.updateUser).toHaveBeenCalledWith({ phoneNumber: '+254700000202' });
    expect(screen.getByText(/1 other device was signed out/)).toBeTruthy();
  });
});

afterAll(async () => {
  // Let the provider's fire-and-forget keychain writes settle.
  await act(async () => {});
});
