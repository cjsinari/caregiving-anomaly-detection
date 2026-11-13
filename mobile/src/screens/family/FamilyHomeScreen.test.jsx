import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import FamilyHomeScreen from './FamilyHomeScreen';
import { FamilyProvider } from '../../family/FamilyContext';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { FAMILY_PORTAL } from '../../navigation/portals';
import { family } from '../../api/family';

/*
 * The family home, item 1 of issue #45: the loved one's status and the latest
 * updates, with the caregiver one tap from a call (item 4).
 *
 * The test that matters most is the switcher one. An account linked to two
 * parents must never show one parent's status beside the other's name.
 */

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'whenUnlocked',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('../../api/family', () => ({
  family: { recipients: jest.fn(), overview: jest.fn() },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', fullName: 'Peter Wanjiku', role: 'family' } }),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false };

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const MUM = { id: 'rec-001', fullName: 'Margaret Wanjiku', relationship: 'Mother', age: 78, status: 'stable' };
const DAD = { id: 'rec-002', fullName: 'Joseph Wanjiku', relationship: 'Father', age: 81, status: 'attention' };

const overviewFor = (r, overrides = {}) => ({
  recipient: { ...r, statusNote: `${r.fullName} note`, conditions: [] },
  lastVisit: {
    id: `last-${r.id}`,
    kind: 'visit',
    at: hoursAgo(20),
    title: 'Morning visit completed',
    body: 'Good spirits.',
    author: 'Grace Wanjiru',
    visit: { wellbeing: 'well', tasksDone: 5, tasksTotal: 5, checkInAt: hoursAgo(21), checkOutAt: hoursAgo(20) },
  },
  nextVisit: { id: 'v1', at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), kind: 'Daily check-in', caregiver: 'Grace Wanjiru' },
  caregiver: { id: 'cg-1', fullName: 'Grace Wanjiru', role: 'Lead caregiver', phone: '+254 700 000 201', isPrimary: true },
  latestUpdates: [
    { id: `u1-${r.id}`, kind: 'visit', at: hoursAgo(20), title: 'Morning visit completed', body: 'Good spirits.', author: 'Grace Wanjiru' },
  ],
  unreadNotifications: 2,
  ...overrides,
});

const launch = async () => render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <FamilyProvider>
      <PortalChromeProvider portal={FAMILY_PORTAL}>
        <FamilyHomeScreen navigation={navigation} />
      </PortalChromeProvider>
    </FamilyProvider>
  </SafeAreaProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  family.overview.mockReset();
  family.recipients.mockResolvedValue({ recipients: [MUM] });
  family.overview.mockImplementation(async (id) => overviewFor(id === DAD.id ? DAD : MUM));
});

describe('how she is doing', () => {
  it('answers it without scrolling: status, the team’s note, and the last visit', async () => {
    await launch();

    await waitFor(() => expect(screen.getByText('Margaret Wanjiku note')).toBeTruthy());
    expect(screen.getByText('Stable')).toBeTruthy();
    expect(screen.getByText('Seemed well at the last visit')).toBeTruthy();
    expect(screen.getByText(/5\/5 tasks/)).toBeTruthy();
  });

  it('greets the family member, not the loved one', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText(/, Peter$/)).toBeTruthy());
  });

  it('shows the unread count on the bell, in words for a screen reader', async () => {
    await launch();

    await waitFor(() => expect(screen.getByLabelText('Notifications, 2 unread')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Notifications, 2 unread'));
    expect(navigation.navigate).toHaveBeenCalledWith('Notifications');
  });
});

describe('getting around', () => {
  it('"See all" opens the care updates feed', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Latest Updates')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('See all'));
    expect(navigation.navigate).toHaveBeenCalledWith('CareUpdates');
  });

  it('the next visit opens the schedule', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Next Visit')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/^Next visit .* Daily check-in with Grace Wanjiru\.$/));
    expect(navigation.navigate).toHaveBeenCalledWith('Schedule');
  });

  it('the care plan card opens the care plan', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Care plan')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Margaret Wanjiku\'s care plan'));
    expect(navigation.navigate).toHaveBeenCalledWith('CarePlan');
  });

  it('puts the caregiver one tap from a call', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Grace Wanjiru')).toBeTruthy());
    expect(screen.getByLabelText('Call')).toBeTruthy();
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });
});

describe('more than one loved one', () => {
  beforeEach(() => {
    family.recipients.mockResolvedValue({ recipients: [MUM, DAD] });
  });

  it('offers a switcher, and the whole screen follows it', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku note')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Joseph Wanjiku, Father'));

    await waitFor(() => expect(screen.getByText('Joseph Wanjiku note')).toBeTruthy());
    expect(family.overview).toHaveBeenLastCalledWith('rec-002');
    // Never one parent's status beside the other's name.
    expect(screen.queryByText('Margaret Wanjiku note')).toBeNull();
    expect(screen.getByText('Needs attention')).toBeTruthy();
  });

  it('draws no switcher for a single loved one', async () => {
    family.recipients.mockResolvedValue({ recipients: [MUM] });
    await launch();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku note')).toBeTruthy());

    expect(screen.queryByLabelText('Whose care to show')).toBeNull();
  });
});

describe('the states around it', () => {
  it('explains a brand-new account with nobody linked', async () => {
    family.recipients.mockResolvedValue({ recipients: [] });
    await launch();

    await waitFor(() => expect(screen.getByText('No loved one linked yet')).toBeTruthy());
    expect(family.overview).not.toHaveBeenCalled();
  });

  it('says when nothing is booked and nothing has happened yet', async () => {
    family.overview.mockResolvedValue(overviewFor(MUM, { nextVisit: null, latestUpdates: [], lastVisit: null }));
    await launch();

    await waitFor(() => expect(screen.getByText('No visit booked')).toBeTruthy());
    expect(screen.getByText('No updates yet')).toBeTruthy();
    expect(screen.getByText('No visits recorded yet.')).toBeTruthy();
  });

  it('offers a retry when the overview fails', async () => {
    family.overview.mockRejectedValueOnce(new Error('The care service is not responding.'));
    await launch();

    await waitFor(() => expect(screen.getByText('The care service is not responding.')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku note')).toBeTruthy());
  });
});
