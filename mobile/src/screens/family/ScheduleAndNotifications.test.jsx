import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ScheduleScreen from './ScheduleScreen';
import NotificationsScreen from './NotificationsScreen';
import { FamilyProvider, __prefsKeyForTests } from '../../family/FamilyContext';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { FAMILY_PORTAL } from '../../navigation/portals';
import { family } from '../../api/family';

/*
 * Items 5 and 6 of issue #45: the upcoming-visits schedule and the
 * notification list.
 *
 * The notification tests that matter are the ones about what is *not* shown.
 * A muted category is left out and the list says so; incidents and account
 * notices can never be left out; and half a list is never presented as the
 * whole one.
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
  family: {
    recipients: jest.fn(),
    schedule: jest.fn(),
    notifications: jest.fn(),
    markNotificationsRead: jest.fn(),
  },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', fullName: 'Peter Wanjiku', role: 'family' } }),
}));

const SecureStore = require('expo-secure-store');
const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false };

const at = (dayOffset, hh, mm = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

const launch = async (Screen) => render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <FamilyProvider>
      <PortalChromeProvider portal={FAMILY_PORTAL}>
        <Screen navigation={navigation} />
      </PortalChromeProvider>
    </FamilyProvider>
  </SafeAreaProvider>
);

const NOTES = [
  { id: 'care-1', category: 'visit', title: 'Visit completed', message: 'Grace finished the morning visit.', createdAt: at(0, 11), readAt: null },
  { id: 'care-2', category: 'incident', title: 'Incident reported', message: 'Margaret slipped. No injury.', createdAt: at(-1, 15), readAt: null },
  { id: 'account-7', category: 'account', title: 'New device added', message: 'A new device was verified.', createdAt: at(-2, 9), readAt: at(-2, 10) },
];

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.__store.clear();
  family.markNotificationsRead.mockReset();
  family.notifications.mockReset();
  family.recipients.mockResolvedValue({
    recipients: [{ id: 'rec-001', fullName: 'Margaret Wanjiku', relationship: 'Mother', status: 'stable' }],
  });
  family.schedule.mockResolvedValue({
    visits: [
      { id: 'v1', at: at(0, 14), kind: 'Daily check-in', caregiver: 'Grace Wanjiru' },
      { id: 'v2', at: at(1, 10), kind: 'Morning visit', caregiver: 'Grace Wanjiru' },
      { id: 'v3', at: at(1, 16), kind: 'Evening visit', caregiver: 'Daniel Kiprop' },
      { id: 'v4', at: at(9, 9, 30), kind: 'Clinic escort', caregiver: 'Grace Wanjiru', note: 'Ankle review' },
    ],
  });
  family.notifications.mockResolvedValue({ items: NOTES, partial: null });
  family.markNotificationsRead.mockResolvedValue({ ok: true });
});

describe('the schedule', () => {
  it('groups visits under the day they fall on', async () => {
    await launch(ScheduleScreen);

    await waitFor(() => expect(screen.getByText('Today')).toBeTruthy());
    expect(screen.getByText('Tomorrow')).toBeTruthy();
    // Two visits tomorrow, one heading.
    expect(screen.getAllByText('Tomorrow')).toHaveLength(1);
    expect(screen.getByText('Evening visit')).toBeTruthy();
  });

  it('names who is coming, so a relief caregiver is not a stranger at the door', async () => {
    await launch(ScheduleScreen);

    await waitFor(() => expect(screen.getByText('Daniel Kiprop')).toBeTruthy());
    expect(screen.getByText('Ankle review')).toBeTruthy();
  });

  it('explains an empty schedule', async () => {
    family.schedule.mockResolvedValue({ visits: [] });
    await launch(ScheduleScreen);

    await waitFor(() => expect(screen.getByText('No visits booked')).toBeTruthy());
  });

  it('offers a retry when the schedule fails', async () => {
    family.schedule.mockRejectedValueOnce(new Error('Offline'));
    await launch(ScheduleScreen);

    await waitFor(() => expect(screen.getByLabelText('Try again')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.getByText('Today')).toBeTruthy());
  });
});

describe('notifications', () => {
  it('lists care and account notices together, with the unread count', async () => {
    await launch(NotificationsScreen);

    await waitFor(() => expect(screen.getByText('Visit completed')).toBeTruthy());
    expect(screen.getByText('New device added')).toBeTruthy();
    expect(screen.getByText('2 unread')).toBeTruthy();
    expect(screen.getByLabelText(/^Unread\. Incident reported/)).toBeTruthy();
  });

  it('marks everything read at once, and puts it back if that fails', async () => {
    family.markNotificationsRead.mockRejectedValueOnce(new Error('Could not reach LindaCare.'));
    await launch(NotificationsScreen);
    await waitFor(() => expect(screen.getByText('2 unread')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('Mark all read'));

    await waitFor(() => expect(screen.getByText('Could not reach LindaCare.')).toBeTruthy());
    expect(screen.getByText('2 unread')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Mark all read'));
    await waitFor(() => expect(screen.getByText('All caught up')).toBeTruthy());
  });

  it('leaves out a muted category, and says that it has', async () => {
    SecureStore.__store.set(__prefsKeyForTests('user-1'), JSON.stringify({ muted: { visit: true } }));
    await launch(NotificationsScreen);

    await waitFor(() => expect(screen.getByText('Incident reported')).toBeTruthy());
    expect(screen.queryByText('Visit completed')).toBeNull();
    expect(screen.getByText(/Completed visits is hidden by your settings/)).toBeTruthy();
  });

  it('never hides an incident or an account notice, whatever is stored', async () => {
    // Even a settings file that claims to mute them -- tampered with, or from
    // a future version -- does not get to.
    SecureStore.__store.set(__prefsKeyForTests('user-1'), JSON.stringify({
      muted: { incident: true, account: true },
    }));
    await launch(NotificationsScreen);

    await waitFor(() => expect(screen.getByText('Incident reported')).toBeTruthy());
    expect(screen.getByText('New device added')).toBeTruthy();
  });

  it('says which half is missing rather than presenting half a list', async () => {
    family.notifications.mockResolvedValue({
      items: NOTES.filter((n) => n.category !== 'account'),
      partial: 'account',
    });
    await launch(NotificationsScreen);

    await waitFor(() => expect(screen.getByText('Account notices did not load')).toBeTruthy());
    expect(screen.getByText('Visit completed')).toBeTruthy();
  });

  it('explains an empty list', async () => {
    family.notifications.mockResolvedValue({ items: [], partial: null });
    await launch(NotificationsScreen);

    await waitFor(() => expect(screen.getByText('No notifications')).toBeTruthy());
    expect(screen.getByText('All caught up')).toBeTruthy();
  });

  it('offers a retry when nothing could be loaded', async () => {
    family.notifications.mockRejectedValueOnce(new Error('Offline'));
    await launch(NotificationsScreen);

    await waitFor(() => expect(screen.getByLabelText('Try again')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.getByText('Visit completed')).toBeTruthy());
  });
});
