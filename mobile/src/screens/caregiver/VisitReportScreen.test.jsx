import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import VisitReportScreen from './VisitReportScreen';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { care } from '../../api/caregiver';

/*
 * The visit report: items 4, 5 and 6 of issue #44.
 *
 * Two things here are worth defending with tests rather than with care.
 *
 * The submit gate. A report that can be filed with no arrival time, no
 * wellbeing, or an "Unwell" with nothing written underneath it is a record
 * that wastes a supervisor's time at best and hides a deteriorating patient
 * at worst. The gate is also the thing most likely to be loosened later by
 * somebody who just wants the form to submit in a demo.
 *
 * The times. They are recorded by the check-in and check-out buttons and are
 * not typable, which is a deliberate departure from the mockup (see the
 * screen's own notes). A future edit that turns them into TextInputs would
 * make every report's arrival time an assertion rather than an observation,
 * and would sail through code review as "matching the design".
 */

jest.mock('../../api/caregiver', () => ({
  care: {
    visit: jest.fn(),
    visits: jest.fn(),
    recipient: jest.fn(),
    setTask: jest.fn(),
    checkIn: jest.fn(),
    checkOut: jest.fn(),
    submitReport: jest.fn(),
  },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { fullName: 'Grace Wanjiru', role: 'caregiver' } }),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };

/*
 * Every host TextInput under an element.
 *
 * Testing Library 14 dropped the UNSAFE_*ByType queries, and there is no
 * public query for "any editable field" -- the whole point of the library is
 * that you ask for things the way a user perceives them, and a user does not
 * perceive component types. This one assertion genuinely is about the
 * component type, so it walks the tree itself rather than pretending
 * otherwise.
 */
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

const RECIPIENT = {
  id: 'rec-001',
  fullName: 'Margaret Wanjiku',
  age: 78,
  address: 'Apt 3B, Westlands Road, Nairobi',
  conditions: ['Diabetic'],
};

const visitWith = (overrides = {}) => ({
  id: 'visit-001',
  recipientId: 'rec-001',
  recipientName: 'Margaret Wanjiku',
  kind: 'Daily check-in',
  location: 'Westlands, Nairobi',
  scheduledFor: '2026-11-13T11:00:00.000Z',
  status: 'upcoming',
  checkInAt: null,
  checkOutAt: null,
  tasks: [
    { id: 't1', label: 'Medication', done: false },
    { id: 't2', label: 'Meals', done: false },
  ],
  ...overrides,
});

const renderScreen = async (params = { visitId: 'visit-001', recipientId: 'rec-001' }) => render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <PortalChromeProvider>
      <VisitReportScreen navigation={navigation} route={{ params }} />
    </PortalChromeProvider>
  </SafeAreaProvider>
);

/*
 * One visit, mutated by the mocks, exactly as the service mutates one row.
 *
 * Worth doing properly rather than resolving each call with an independent
 * literal: the screen folds every response back into its own state, so a
 * `setTask` that answered with a visit that had forgotten its check-in time
 * would silently undo the check-in. That is a bug the mock would be inventing,
 * and chasing it would teach nothing about the screen.
 */
let visitState;

const asCheckedIn = () => { visitState = { ...visitState, checkInAt: '2026-11-13T11:02:00.000Z', status: 'in_progress' }; };

beforeEach(() => {
  jest.clearAllMocks();
  visitState = visitWith();

  care.visit.mockImplementation(async () => visitState);
  care.recipient.mockResolvedValue(RECIPIENT);
  care.visits.mockImplementation(async () => ({ visits: [visitState] }));

  care.setTask.mockImplementation(async (visitId, taskId, done) => {
    visitState = {
      ...visitState,
      tasks: visitState.tasks.map((t) => (t.id === taskId ? { ...t, done } : t)),
    };
    return visitState;
  });

  care.checkIn.mockImplementation(async () => {
    asCheckedIn();
    return visitState;
  });

  care.checkOut.mockImplementation(async () => {
    visitState = { ...visitState, checkOutAt: '2026-11-13T12:10:00.000Z', status: 'completed' };
    return visitState;
  });

  care.submitReport.mockResolvedValue({ id: 'report-1' });
});

const ready = () => waitFor(() => expect(screen.getByText('Visit Times')).toBeTruthy());

describe('opening the report', () => {
  it('names the person, the place and the date', async () => {
    await renderScreen();
    await ready();

    expect(screen.getByText(/Margaret Wanjiku · Westlands, Nairobi/)).toBeTruthy();
    expect(screen.getByText('Client Wellbeing')).toBeTruthy();
    expect(screen.getByText('Tasks Completed')).toBeTruthy();
    expect(screen.getByText('Visit Notes')).toBeTruthy();
  });

  it('shows an unrecorded time as blank, not as a guess', async () => {
    await renderScreen();
    await ready();

    expect(screen.getByLabelText('Check-in time: not recorded yet')).toBeTruthy();
    expect(screen.getByLabelText('Check-out time: not recorded yet')).toBeTruthy();
  });

  it('offers no way to type a time', async () => {
    await renderScreen();
    await ready();

    // The only text input on this screen is the notes field. If this ever
    // fails, read the screen's note on why the times are recorded, not typed.
    const inputs = textInputsIn(screen.root);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].props.accessibilityLabel).toBe('Visit notes');

    // And the time slots specifically are inert text, not fields.
    const checkIn = screen.getByLabelText('Check-in time: not recorded yet');
    expect(checkIn.props.onChangeText).toBeUndefined();
  });
});

describe('check in and check out', () => {
  it('records the arrival and shows it', async () => {
    await renderScreen();
    await ready();

    await fireEvent.press(screen.getByLabelText('Check in'));

    await waitFor(() => expect(care.checkIn).toHaveBeenCalledWith('visit-001'));
    await waitFor(() => expect(screen.getByLabelText(/^Check-in time: \d\d:\d\d$/)).toBeTruthy());
    // Having arrived, the next action on offer is leaving.
    expect(screen.getByLabelText('Check out')).toBeTruthy();
  });

  it('checks in by itself when the dashboard sent us here to do that', async () => {
    await renderScreen({ visitId: 'visit-001', recipientId: 'rec-001', autoCheckIn: true });

    await waitFor(() => expect(care.checkIn).toHaveBeenCalledWith('visit-001'));
  });

  it('says so when the arrival could not be recorded', async () => {
    care.checkIn.mockRejectedValue(new Error('The care service is not responding.'));

    await renderScreen();
    await ready();
    await fireEvent.press(screen.getByLabelText('Check in'));

    await waitFor(() =>
      expect(screen.getByText('The care service is not responding.')).toBeTruthy());
    // Still offering the action, because the fix is to try again.
    expect(screen.getByLabelText('Check in')).toBeTruthy();
  });
});

describe('the tasks save as they are ticked', () => {
  it('sends each tick straight away', async () => {
    await renderScreen();
    await ready();

    await fireEvent.press(screen.getByLabelText('Medication'));

    await waitFor(() => expect(care.setTask).toHaveBeenCalledWith('visit-001', 't1', true));
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('puts a failed tick back and explains it on the row', async () => {
    care.setTask.mockRejectedValue(new Error('Could not reach the care service.'));

    await renderScreen();
    await ready();
    await fireEvent.press(screen.getByLabelText('Medication'));

    await waitFor(() =>
      expect(screen.getByText('Could not reach the care service.')).toBeTruthy());
    expect(screen.getByText('0 of 2')).toBeTruthy();
  });
});

describe('what has to be true before it can be filed', () => {
  it('will not submit without a check-in', async () => {
    await renderScreen();
    await ready();

    expect(screen.getByText('Check in when you arrive.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Submit Visit Report'));
    expect(care.submitReport).not.toHaveBeenCalled();
  });

  it('will not submit without a wellbeing', async () => {
    asCheckedIn();

    await renderScreen();
    await ready();

    expect(screen.getByText('Choose how the client is doing.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Submit Visit Report'));
    expect(care.submitReport).not.toHaveBeenCalled();
  });

  it('demands a note when the client is marked unwell', async () => {
    asCheckedIn();

    await renderScreen();
    await ready();
    await fireEvent.press(screen.getByLabelText('Unwell'));

    // "Unwell" on its own tells a supervisor something is wrong and nothing
    // about what.
    expect(screen.getByText('Add a note explaining the wellbeing you chose.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Submit Visit Report'));
    expect(care.submitReport).not.toHaveBeenCalled();

    await fireEvent.changeText(
      screen.getByLabelText('Visit notes'),
      'Running a temperature of 38.4 and declined lunch. Called her son and the clinic.'
    );

    await fireEvent.press(screen.getByLabelText('Submit Visit Report'));
    await waitFor(() => expect(care.submitReport).toHaveBeenCalled());
  });

  it('does not demand a note when the client is well', async () => {
    asCheckedIn();

    await renderScreen();
    await ready();
    await fireEvent.press(screen.getByLabelText('Well'));

    expect(screen.getByText('Reports are signed and tamper-evident once submitted.')).toBeTruthy();
  });
});

describe('filing it', () => {
  const fillIn = async () => {
    asCheckedIn();
    await renderScreen();
    await ready();
    await fireEvent.press(screen.getByLabelText('Medication'));
    await waitFor(() => expect(care.setTask).toHaveBeenCalled());
    await fireEvent.press(screen.getByLabelText('Well'));
    await fireEvent.changeText(screen.getByLabelText('Visit notes'), 'Good spirits. BP 128/84.');
  };

  it('sends everything the report is made of', async () => {
    await fillIn();
    await fireEvent.press(screen.getByLabelText('Submit Visit Report'));

    await waitFor(() => expect(care.submitReport).toHaveBeenCalled());
    expect(care.submitReport).toHaveBeenCalledWith(expect.objectContaining({
      visitId: 'visit-001',
      recipientId: 'rec-001',
      wellbeing: 'well',
      notes: 'Good spirits. BP 128/84.',
      tasks: ['t1'],
      checkInAt: '2026-11-13T11:02:00.000Z',
      filedBy: 'Grace Wanjiru',
    }));
  });

  it('returns to the dashboard, where the result is visible', async () => {
    await fillIn();
    await fireEvent.press(screen.getByLabelText('Submit Visit Report'));

    await waitFor(() => expect(navigation.navigate).toHaveBeenCalledWith(
      // Home is a tab and the report is pushed over the tabs (#46), so it is
      // reached through the tab navigator: see navigation/routes.js.
      'CaregiverTabs', { screen: 'CaregiverHome', params: { filed: 'Margaret Wanjiku' } }
    ));
  });

  it('keeps the filled-in report on screen when filing fails', async () => {
    care.submitReport.mockRejectedValue(new Error('The report was rejected.'));

    await fillIn();
    await fireEvent.press(screen.getByLabelText('Submit Visit Report'));

    await waitFor(() => expect(screen.getByText('Not submitted')).toBeTruthy());
    // Losing the notes here would mean rewriting them standing in a doorway.
    expect(screen.getByLabelText('Visit notes').props.value).toBe('Good spirits. BP 128/84.');
    expect(navigation.navigate).not.toHaveBeenCalledWith('CaregiverTabs', expect.anything());
  });
});

describe('an unscheduled visit', () => {
  it('can still be reported on, and says that is what it is', async () => {
    care.visits.mockResolvedValue({ visits: [] });

    await renderScreen({ recipientId: 'rec-001' });
    await ready();

    expect(screen.getByText('No scheduled visit')).toBeTruthy();
    expect(screen.getByText(/filed as an unscheduled visit/)).toBeTruthy();
    // No visit means no check-in to wait for; a wellbeing is all it needs.
    await fireEvent.press(screen.getByLabelText('Okay'));
    await fireEvent.press(screen.getByLabelText('Submit Visit Report'));

    await waitFor(() => expect(care.submitReport).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: null, recipientId: 'rec-001', wellbeing: 'okay' })
    ));
  });
});
