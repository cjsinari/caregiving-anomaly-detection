import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import CarePlanScreen from './CarePlanScreen';
import { FamilyProvider, __prefsKeyForTests } from '../../family/FamilyContext';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { FAMILY_PORTAL } from '../../navigation/portals';
import { family } from '../../api/family';

/*
 * The loved one's profile and care plan (item 3), the caregiver card (item 4),
 * and the family member's own settings.
 *
 * Two claims carry the weight here:
 *
 *   Read-only. The only text field on the screen is the family member's own
 *   name for their loved one. Anything else editable would be a way to change
 *   the care team's record.
 *
 *   "Profile edits persist after relaunch." A relaunch is simulated the only
 *   honest way available to a test: unmount everything, mount it again
 *   against the same keychain, and see what comes back.
 */

jest.mock('expo-secure-store', () => {
  const store = new Map();
  return {
    WHEN_UNLOCKED: 'whenUnlocked',
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => { store.set(key, value); }),
    deleteItemAsync: jest.fn(async (key) => { store.delete(key); }),
    __store: store,
  };
});

jest.mock('../../api/family', () => ({
  family: { recipients: jest.fn(), recipient: jest.fn() },
}));

const mockAuth = { user: { id: 'user-1', fullName: 'Peter Wanjiku', role: 'family' } };
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => mockAuth }));

const SecureStore = require('expo-secure-store');
const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false };

const RECORD = {
  id: 'rec-001',
  fullName: 'Margaret Wanjiku',
  relationship: 'Mother',
  age: 78,
  dateOfBirth: '1948-03-14',
  address: 'Apt 3B, Westlands Road, Nairobi',
  conditions: ['Type 2 diabetes', 'Hypertension'],
  status: 'stable',
  careStartedOn: '2026-01-12',
  carePlan: {
    summary: 'Daily support at home.',
    goals: ['Blood sugar kept within her target range'],
    routine: [{ id: 'r1', label: 'Medication', frequency: 'Every visit' }],
    medications: [{ id: 'm1', name: 'Metformin', dose: '500 mg', schedule: 'Twice daily, with food' }],
    dietary: 'Low sugar.',
    mobility: 'Walks with a stick.',
    reviewedOn: '2026-10-30',
  },
  emergencyContacts: [
    { id: 'ec-1', name: 'Peter Wanjiku', relationship: 'Son', phone: '+254 700 000 101', isPrimary: true },
  ],
  caregivers: [
    { id: 'cg-1', fullName: 'Grace Wanjiru', role: 'Lead caregiver', phone: '+254 700 000 201', isPrimary: true },
  ],
};

/** Every host TextInput under an element; RNTL 14 has no query for it. */
function textInputsIn(element) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'TextInput') found.push(node);
    (node.children || []).forEach(walk);
  };
  walk(element);
  return found;
}

/*
 * The whole app as far as this screen is concerned. `generation` is a key on
 * the root: changing it makes React unmount every component and mount fresh
 * ones, with no state carried across -- which is a relaunch, minus the
 * process. The keychain mock is the only thing that survives, exactly as the
 * real keychain is the only thing that survives a real relaunch.
 */
const tree = (generation = 0) => (
  <SafeAreaProvider
    key={generation}
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <FamilyProvider>
      <PortalChromeProvider portal={FAMILY_PORTAL}>
        <CarePlanScreen navigation={navigation} />
      </PortalChromeProvider>
    </FamilyProvider>
  </SafeAreaProvider>
);

const launch = async () => render(tree(0));

/** Tear everything down and start again against the same keychain. */
const relaunch = async (app) => app.rerender(tree(Date.now()));

const ready = () => waitFor(() => expect(screen.getByText('Metformin')).toBeTruthy());

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.__store.clear();
  mockAuth.user = { id: 'user-1', fullName: 'Peter Wanjiku', role: 'family' };
  family.recipients.mockResolvedValue({
    recipients: [{ id: 'rec-001', fullName: 'Margaret Wanjiku', relationship: 'Mother', age: 78, status: 'stable' }],
  });
  family.recipient.mockResolvedValue(RECORD);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

describe('the record', () => {
  it('shows the profile, the plan, the medications and the care team', async () => {
    await launch();
    await ready();

    expect(screen.getByText('14 Mar 1948')).toBeTruthy();
    expect(screen.getByText('Daily support at home.')).toBeTruthy();
    expect(screen.getByText('Blood sugar kept within her target range')).toBeTruthy();
    expect(screen.getByText('Grace Wanjiru')).toBeTruthy();
    expect(screen.getByText(/This is the care team’s record/)).toBeTruthy();
  });

  it('has exactly one text field, and it is not part of the record', async () => {
    await launch();
    await ready();

    const inputs = textInputsIn(screen.root);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].props.accessibilityLabel).toBe('What you call Margaret Wanjiku');
  });
});

describe('the caregiver card', () => {
  it('calls and messages the caregiver', async () => {
    await launch();
    await ready();

    await fireEvent.press(screen.getByLabelText('Call'));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+254700000201');

    await fireEvent.press(screen.getByLabelText('Message'));
    expect(Linking.openURL).toHaveBeenCalledWith('sms:+254700000201');
  });

  it('says why it cannot dial a number the service masked', async () => {
    family.recipient.mockResolvedValue({
      ...RECORD,
      caregivers: [{ ...RECORD.caregivers[0], phone: '+2547****0201' }],
    });

    await launch();
    await ready();

    // The service masks numbers in its care-team listing; dialling one would
    // dial nothing. No dead buttons -- a sentence instead.
    expect(screen.queryByLabelText('Call')).toBeNull();
    expect(screen.getByText(/has not shared a direct number for Grace/)).toBeTruthy();
  });
});

describe('your settings persist after relaunch', () => {
  it('keeps the name you use for your loved one', async () => {
    const first = await launch();
    await ready();

    await fireEvent.changeText(screen.getByLabelText('What you call Margaret Wanjiku'), 'Mum');
    await fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
    await waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalled());

    // Relaunch: everything unmounted, the keychain untouched.
    await relaunch(first);
    await ready();

    await waitFor(() => expect(screen.getAllByText('Mum').length).toBeGreaterThan(0));
    expect(screen.getByLabelText('What you call Margaret Wanjiku').props.value).toBe('Mum');
  });

  it('sends notification choices to Account, where the service keeps them', async () => {
    await launch();
    await ready();

    // The switches that lived here in #45 only filtered the in-app list. They
    // moved to Account in #46, saved on the service so pushes obey them too.
    expect(screen.queryByLabelText('Completed visits')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Notification settings'));
    expect(navigation.navigate).toHaveBeenCalledWith('FamilyTabs', { screen: 'Account', params: undefined });
  });

  it('keeps one account’s settings away from the next on a shared phone', async () => {
    const first = await launch();
    await ready();
    await fireEvent.changeText(screen.getByLabelText('What you call Margaret Wanjiku'), 'Mum');
    await fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalled());

    // A different family member signs in on the same phone.
    mockAuth.user = { id: 'user-2', fullName: 'Alice Ochieng', role: 'family' };
    await relaunch(first);
    await ready();

    expect(screen.getByLabelText('What you call Margaret Wanjiku').props.value).toBe('');
    expect(SecureStore.__store.has(__prefsKeyForTests('user-1'))).toBe(true);
  });

  it('clears the name when the field is emptied', async () => {
    await launch();
    await ready();

    await fireEvent.changeText(screen.getByLabelText('What you call Margaret Wanjiku'), 'Mum');
    await fireEvent.press(screen.getByLabelText('Save'));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('What you call Margaret Wanjiku'), '');
    await fireEvent.press(screen.getByLabelText('Save'));

    await waitFor(() => expect(screen.getAllByText('Margaret Wanjiku').length).toBeGreaterThan(0));
    const stored = JSON.parse(SecureStore.__store.get(__prefsKeyForTests('user-1')));
    expect(stored.nicknames['rec-001']).toBeUndefined();
  });
});

describe('the three states', () => {
  it('explains an account with no loved one linked', async () => {
    family.recipients.mockResolvedValue({ recipients: [] });

    await launch();

    await waitFor(() => expect(screen.getByText('No loved one linked yet')).toBeTruthy());
  });

  it('offers a retry when the care plan fails to load', async () => {
    family.recipient.mockRejectedValueOnce(new Error('The care service is not responding.'));

    await launch();

    await waitFor(() => expect(screen.getByText('Could not load the care plan')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Try again'));
    await ready();
  });
});
