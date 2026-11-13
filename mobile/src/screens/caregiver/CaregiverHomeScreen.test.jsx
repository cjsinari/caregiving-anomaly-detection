import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import CaregiverHomeScreen from './CaregiverHomeScreen';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { care } from '../../api/caregiver';

/*
 * The dashboard, and the two buttons the issue is explicit about: "View all"
 * reaches the assignments list and "Check in" reaches the visit report.
 */

jest.mock('../../api/caregiver', () => ({
  care: { dashboard: jest.fn() },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { fullName: 'Grace Wanjiru', role: 'caregiver' } }),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };

const today = (hh, mm) => {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

const DASHBOARD = {
  sessionRisk: { level: 'low', label: 'Low Risk' },
  counts: { assigned: 3, visitsToday: 2, completedToday: 1 },
  recipients: [
    {
      id: 'rec-001', fullName: 'Margaret Wanjiku', age: 78,
      conditions: ['Diabetic', 'Hypertension'], status: 'stable',
      nextVisitAt: today(14, 0), nextVisitId: 'visit-001',
    },
    {
      id: 'rec-002', fullName: 'James Ochieng', age: 84,
      conditions: ['Post-stroke recovery'], status: 'attention',
      nextVisitAt: today(16, 30), nextVisitId: 'visit-002',
    },
  ],
  visits: [
    {
      id: 'visit-001', recipientId: 'rec-001', recipientName: 'Margaret Wanjiku',
      kind: 'Daily check-in', location: 'Westlands, Nairobi',
      scheduledFor: today(14, 0), status: 'upcoming', checkInAt: null, tasks: [],
    },
    {
      id: 'visit-003', recipientId: 'rec-003', recipientName: 'Esther Muthoni',
      kind: 'Morning visit', location: 'Karen, Nairobi',
      scheduledFor: today(10, 30), status: 'completed',
      checkInAt: today(10, 28), checkOutAt: today(11, 35), tasks: [],
    },
  ],
  alerts: [],
};

const renderScreen = async () => render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <PortalChromeProvider>
      <CaregiverHomeScreen navigation={navigation} />
    </PortalChromeProvider>
  </SafeAreaProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  care.dashboard.mockResolvedValue(DASHBOARD);
});

describe('the day at a glance', () => {
  it('greets the caregiver by name and counts their day', async () => {
    await renderScreen();

    // Two of them on a wide layout: the large title and the sidebar's
    // account row. Both are correct, so this asks for at least one.
    await waitFor(() => expect(screen.getAllByText('Grace Wanjiru').length).toBeGreaterThan(0));
    expect(screen.getByLabelText('3 assigned elders. Opens your assignments.')).toBeTruthy();
    expect(screen.getByLabelText('2 Visits Today')).toBeTruthy();
    expect(screen.getByLabelText('1 Completed Today')).toBeTruthy();
  });

  it('shows the session risk only when the source supplies one', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Session risk: Low Risk')).toBeTruthy());

    care.dashboard.mockResolvedValue({ ...DASHBOARD, sessionRisk: null });
    await renderScreen();

    // Defaulting to a reassuring "Low Risk" on no evidence would be worse
    // than saying nothing.
    await waitFor(() => expect(screen.queryByText('SESSION RISK')).toBeNull());
  });
});

describe('the buttons the issue names', () => {
  it('"View all" opens the assignments list', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Assigned Profiles')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('View all'));

    expect(navigation.navigate).toHaveBeenCalledWith('Assignments');
  });

  it('"Check in" opens the visit report, checking in on arrival', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Visit Schedule')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/Margaret Wanjiku\. Upcoming\./));

    expect(navigation.navigate).toHaveBeenCalledWith('VisitReport', {
      visitId: 'visit-001',
      recipientId: 'rec-001',
      autoCheckIn: true,
    });
  });

  it('a filed visit opens its report without checking in again', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Visit Schedule')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/Esther Muthoni\. Completed\./));

    expect(navigation.navigate).toHaveBeenCalledWith('VisitReport', {
      visitId: 'visit-003',
      recipientId: 'rec-003',
      autoCheckIn: false,
    });
  });

  it('"New Report" opens the chooser', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Visit Schedule')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText('New Report'));

    expect(navigation.navigate).toHaveBeenCalledWith('NewReport');
  });

  it('a profile card opens the care record', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Assigned Profiles')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/Margaret Wanjiku, 78 years/));

    expect(navigation.navigate).toHaveBeenCalledWith('RecipientDetail', { recipientId: 'rec-001' });
  });
});

describe('alerts', () => {
  it('are not drawn when there are none', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Visit Schedule')).toBeTruthy());

    expect(screen.queryByText('Alerts')).toBeNull();
  });

  it('are shown above everything else when there are', async () => {
    care.dashboard.mockResolvedValue({
      ...DASHBOARD,
      alerts: [{
        id: 'alert-1', tone: 'warning', recipientId: 'rec-002',
        title: 'James Ochieng needs attention',
        body: 'Mobility was flagged as worsening at the last two visits.',
      }],
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByText('Alerts')).toBeTruthy());
    expect(screen.getByText('James Ochieng needs attention')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(/^Alert\. James Ochieng needs attention/));
    expect(navigation.navigate).toHaveBeenCalledWith('RecipientDetail', { recipientId: 'rec-002' });
  });
});

describe('the three states', () => {
  it('shows skeletons while the first load runs', async () => {
    let release;
    care.dashboard.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    await renderScreen();
    expect(screen.getAllByLabelText('Loading').length).toBeGreaterThan(0);

    release(DASHBOARD);
    // She is on the profile strip and on the schedule, which is the point.
    await waitFor(() => expect(screen.getAllByText('Margaret Wanjiku').length).toBe(2));
  });

  it('explains an empty day rather than showing a blank card', async () => {
    care.dashboard.mockResolvedValue({
      ...DASHBOARD,
      counts: { assigned: 0, visitsToday: 0, completedToday: 0 },
      recipients: [],
      visits: [],
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByText('No assignments yet')).toBeTruthy());
    expect(screen.getByText('Nothing scheduled today')).toBeTruthy();
  });

  it('offers a retry when the load fails', async () => {
    care.dashboard.mockRejectedValueOnce(new Error('The care service is not responding.'));

    await renderScreen();
    await waitFor(() => expect(screen.getAllByLabelText('Try again').length).toBeGreaterThan(0));

    care.dashboard.mockResolvedValue(DASHBOARD);
    await fireEvent.press(screen.getAllByLabelText('Try again')[0]);

    await waitFor(() => expect(screen.getAllByText('Margaret Wanjiku').length).toBe(2));
  });
});
