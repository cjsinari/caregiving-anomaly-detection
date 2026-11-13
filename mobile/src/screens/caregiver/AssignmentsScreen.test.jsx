import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AssignmentsScreen from './AssignmentsScreen';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { care } from '../../api/caregiver';

/*
 * The assignments list, and the three states item 7 of issue #44 asks every
 * list to have.
 *
 * The search tests are the ones worth having. A filter that works is not
 * interesting; a filter that tells a caregiver they have no patients when
 * they have simply mistyped a name is a support call that nobody can diagnose
 * over the phone, and it is one `if` away at all times.
 */

jest.mock('../../api/caregiver', () => ({
  care: { assignments: jest.fn() },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { fullName: 'Grace Wanjiru', role: 'caregiver' } }),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };

const PEOPLE = [
  {
    id: 'rec-001', reference: 'ASG-001', fullName: 'Margaret Wanjiku', age: 78,
    conditions: ['Diabetic', 'Hypertension'], status: 'stable',
    address: 'Apt 3B, Westlands Road, Nairobi', since: '2026-01-12',
    visitCount: 47, lastVisitAt: '2026-11-12T11:20:00.000Z',
  },
  {
    id: 'rec-002', reference: 'ASG-002', fullName: 'James Ochieng', age: 84,
    conditions: ['Post-stroke recovery'], status: 'attention',
    address: 'House 14, Kilimani Estate, Nairobi', since: '2026-03-03',
    visitCount: 28, lastVisitAt: '2026-11-11T06:00:00.000Z',
  },
];

const payload = (recipients = PEOPLE) => ({
  count: recipients.length,
  active: recipients.length,
  recipients,
});

const renderScreen = async () => render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <PortalChromeProvider>
      <AssignmentsScreen navigation={navigation} />
    </PortalChromeProvider>
  </SafeAreaProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  care.assignments.mockResolvedValue(payload());
});

describe('loading', () => {
  it('shows a skeleton, not a blank page, while the first load runs', async () => {
    let release;
    care.assignments.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    await renderScreen();

    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(screen.getByText('Loading your caseload…')).toBeTruthy();

    release(payload());
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());
  });
});

describe('the list', () => {
  it('renders each person with their status and their counts', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());
    expect(screen.getByText('James Ochieng')).toBeTruthy();
    expect(screen.getByText('2 active · 2 total')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.getByText('47')).toBeTruthy();
  });

  it('opens the care record when a card is tapped', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/Margaret Wanjiku\. Stable\./));

    expect(navigation.navigate).toHaveBeenCalledWith('RecipientDetail', { recipientId: 'rec-001' });
  });

  it('starts a visit report for one person', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());

    await fireEvent.press(screen.getAllByLabelText('File visit report')[0]);

    expect(navigation.navigate).toHaveBeenCalledWith('VisitReport', { recipientId: 'rec-001' });
  });
});

describe('search', () => {
  const type = async (text) =>
    fireEvent.changeText(screen.getByLabelText('Search your assignments by name or address'), text);

  it('filters by name', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());

    await type('ochieng');

    expect(screen.getByText('James Ochieng')).toBeTruthy();
    expect(screen.queryByText('Margaret Wanjiku')).toBeNull();
  });

  it('filters by address, because that is what the placeholder promises', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());

    await type('kilimani');

    expect(screen.getByText('James Ochieng')).toBeTruthy();
    expect(screen.queryByText('Margaret Wanjiku')).toBeNull();
  });

  it('says no match, and never that there are no assignments', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());

    await type('zzzz');

    // The distinction this test exists for: a typo must not be reported as an
    // empty caseload.
    expect(screen.getByText('No match for “zzzz”')).toBeTruthy();
    expect(screen.queryByText('No assignments yet')).toBeNull();
  });

  it('clears back to the full list', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());

    await type('zzzz');
    await fireEvent.press(screen.getByLabelText('Show all assignments'));

    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());
    expect(screen.getByText('James Ochieng')).toBeTruthy();
  });
});

describe('empty', () => {
  it('explains how assignments arrive, and offers no search box', async () => {
    care.assignments.mockResolvedValue(payload([]));

    await renderScreen();

    await waitFor(() => expect(screen.getByText('No assignments yet')).toBeTruthy());
    expect(screen.getByText(/A family member adds you to a care team/)).toBeTruthy();
    // A filter above an empty list is furniture.
    expect(screen.queryByLabelText('Search your assignments by name or address')).toBeNull();
  });
});

describe('error', () => {
  it('shows the reason and a way back', async () => {
    care.assignments.mockRejectedValue(new Error('The care service is not responding.'));

    await renderScreen();

    await waitFor(() => expect(screen.getByText('Could not load this')).toBeTruthy());
    expect(screen.getByText('The care service is not responding.')).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
  });

  it('retries on demand', async () => {
    care.assignments.mockRejectedValueOnce(new Error('Offline'));

    await renderScreen();
    await waitFor(() => expect(screen.getByLabelText('Try again')).toBeTruthy());

    care.assignments.mockResolvedValue(payload());
    await fireEvent.press(screen.getByLabelText('Try again'));

    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());
  });

  it('keeps the list on screen when a refresh fails', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Margaret Wanjiku')).toBeTruthy());

    care.assignments.mockRejectedValue(new Error('Offline'));
    // A failed refresh must not blank a list the caregiver is reading. Stale
    // visits beat no visits.
    await fireEvent.press(screen.getAllByLabelText('File visit report')[0]);

    expect(screen.getByText('Margaret Wanjiku')).toBeTruthy();
  });
});
