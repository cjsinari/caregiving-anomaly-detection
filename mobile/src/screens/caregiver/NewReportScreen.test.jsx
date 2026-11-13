import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NewReportScreen from './NewReportScreen';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { care } from '../../api/caregiver';

/*
 * "New Report" -> choose who it is about -> a report bound to them.
 *
 * The distinction worth holding: picking today's visit opens a report
 * attached to that visit, with its checklist; picking a name from the
 * caseload opens one attached only to the person. Collapsing the two is how a
 * report ends up filed against the wrong visit.
 */

jest.mock('../../api/caregiver', () => ({
  care: { assignments: jest.fn(), visits: jest.fn() },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { fullName: 'Grace Wanjiru', role: 'caregiver' } }),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };

const todayAt = (hh, mm) => {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

const PEOPLE = [
  { id: 'rec-001', fullName: 'Margaret Wanjiku', status: 'stable', lastVisitAt: todayAt(9, 0) },
  { id: 'rec-002', fullName: 'James Ochieng', status: 'attention', lastVisitAt: null },
];

const VISITS = [
  {
    id: 'visit-001', recipientId: 'rec-001', recipientName: 'Margaret Wanjiku',
    kind: 'Daily check-in', scheduledFor: todayAt(14, 0), status: 'upcoming',
    tasks: [{ id: 't1', label: 'Medication', done: false }],
  },
  {
    id: 'visit-003', recipientId: 'rec-003', recipientName: 'Esther Muthoni',
    kind: 'Morning visit', scheduledFor: todayAt(10, 30), status: 'completed', tasks: [],
  },
];

const renderScreen = async () => render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <PortalChromeProvider>
      <NewReportScreen navigation={navigation} />
    </PortalChromeProvider>
  </SafeAreaProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  care.assignments.mockResolvedValue({ count: 2, active: 2, recipients: PEOPLE });
  care.visits.mockResolvedValue({ visits: VISITS });
});

describe('choosing', () => {
  it('offers today’s unfinished visits first', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Today’s visits')).toBeTruthy());
    // The 10:30 is already filed, so it is not on offer.
    expect(screen.queryByText('Esther Muthoni')).toBeNull();
  });

  it('opens a report attached to the visit, with its checklist', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Today’s visits')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/14:00, Margaret Wanjiku\. Daily check-in\./));

    expect(navigation.navigate).toHaveBeenCalledWith('VisitReport', {
      visitId: 'visit-001',
      recipientId: 'rec-001',
    });
  });

  it('opens a report attached only to the person, for an unscheduled call', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Someone else')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/James Ochieng\. Needs attention\./));

    // No visitId: this is not pretending to be a scheduled visit.
    expect(navigation.navigate).toHaveBeenCalledWith('VisitReport', { recipientId: 'rec-002' });
  });

  it('calls the second list "Your assignments" when nothing is scheduled', async () => {
    care.visits.mockResolvedValue({ visits: [] });

    await renderScreen();

    await waitFor(() => expect(screen.getByText('Your assignments')).toBeTruthy());
    expect(screen.queryByText('Today’s visits')).toBeNull();
  });
});

describe('the three states', () => {
  it('shows a skeleton first', async () => {
    let release;
    care.assignments.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    await renderScreen();
    expect(screen.getByLabelText('Loading')).toBeTruthy();

    release({ count: 2, active: 2, recipients: PEOPLE });
    await waitFor(() => expect(screen.getByText('James Ochieng')).toBeTruthy());
  });

  it('explains an empty caseload', async () => {
    care.assignments.mockResolvedValue({ count: 0, active: 0, recipients: [] });
    care.visits.mockResolvedValue({ visits: [] });

    await renderScreen();

    await waitFor(() => expect(screen.getByText('Nobody to report on yet')).toBeTruthy());
  });

  it('offers a retry when the load fails', async () => {
    care.assignments.mockRejectedValueOnce(new Error('Offline'));

    await renderScreen();

    await waitFor(() => expect(screen.getByLabelText('Try again')).toBeTruthy());
  });
});
