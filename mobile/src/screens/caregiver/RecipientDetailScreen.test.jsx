import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RecipientDetailScreen from './RecipientDetailScreen';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { care } from '../../api/caregiver';

/*
 * The care record, and the note form it carries.
 *
 * The ordering test is the one with teeth. Emergency contacts are above
 * medications on this screen because of what happens in the ten seconds after
 * somebody falls, and that is exactly the kind of decision a later tidy-up
 * reverses on the grounds that reference material belongs at the bottom.
 */

jest.mock('../../api/caregiver', () => ({
  care: { recipient: jest.fn(), addCareNote: jest.fn() },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { fullName: 'Grace Wanjiru', role: 'caregiver' } }),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };

const PERSON = {
  id: 'rec-001',
  reference: 'ASG-001',
  fullName: 'Margaret Wanjiku',
  age: 78,
  dateOfBirth: '1948-03-14',
  conditions: ['Diabetic', 'Hypertension'],
  status: 'stable',
  address: 'Apt 3B, Westlands Road, Nairobi',
  since: '2026-01-12',
  visitCount: 47,
  lastVisitAt: '2026-11-12T11:20:00.000Z',
  medications: [
    { id: 'med-1', name: 'Metformin', dose: '500 mg', schedule: 'Twice daily, with food', notes: 'Morning and evening' },
  ],
  careNotes: [
    { id: 'note-1', author: 'Grace Wanjiru', at: '2026-11-12T11:20:00.000Z', body: 'Blood pressure 128/84.' },
  ],
  emergencyContacts: [
    { id: 'ec-1', name: 'Peter Wanjiku', relationship: 'Son', phone: '+254 700 000 101', isPrimary: true },
  ],
};

const renderScreen = async () => render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <PortalChromeProvider>
      <RecipientDetailScreen navigation={navigation} route={{ params: { recipientId: 'rec-001' } }} />
    </PortalChromeProvider>
  </SafeAreaProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  care.recipient.mockResolvedValue(PERSON);
  care.addCareNote.mockResolvedValue({ id: 'note-2' });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

describe('the record', () => {
  it('shows all four sections the issue asks for', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByText('Emergency Contacts')).toBeTruthy());
    expect(screen.getByText('Medications')).toBeTruthy();
    expect(screen.getByText('Care Notes')).toBeTruthy();
    expect(screen.getByText('14 Mar 1948')).toBeTruthy();       // the profile
    expect(screen.getByText('Metformin')).toBeTruthy();
    expect(screen.getByText('Blood pressure 128/84.')).toBeTruthy();
    expect(screen.getByText('Peter Wanjiku')).toBeTruthy();
  });

  it('puts emergency contacts above medications', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Emergency Contacts')).toBeTruthy());

    const order = screen.getAllByRole('header').map((h) => h.props.children);
    expect(order.indexOf('Emergency Contacts')).toBeLessThan(order.indexOf('Medications'));
  });

  it('dials a contact', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Peter Wanjiku')).toBeTruthy());

    await fireEvent.press(screen.getByLabelText(/Peter Wanjiku, Son, primary contact/));

    // Spaces stripped: a tel: URL with them in does nothing on some diallers.
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+254700000101');
  });
});

describe('writing a note', () => {
  const open = async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByText('Care Notes')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Add note'));
    await waitFor(() => expect(screen.getByLabelText('Care note details')).toBeTruthy());
  };

  it('saves a care note against this person', async () => {
    await open();

    await fireEvent.changeText(
      screen.getByLabelText('Care note details'),
      'Ate a full lunch and walked to the gate unaided.'
    );
    await fireEvent.press(screen.getByLabelText('Save care note'));

    await waitFor(() => expect(care.addCareNote).toHaveBeenCalledWith({
      recipientId: 'rec-001',
      body: 'Ate a full lunch and walked to the gate unaided.',
      kind: 'note',
      author: 'Grace Wanjiru',
    }));
  });

  it('will not save an empty one, and says why', async () => {
    await open();

    expect(screen.getByText('Write what happened to save this.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Save care note'));
    expect(care.addCareNote).not.toHaveBeenCalled();
  });

  it('asks for more detail on an incident than on a note', async () => {
    await open();

    await fireEvent.changeText(screen.getByLabelText('Care note details'), 'She had a fall.');
    // Fine as a note...
    expect(screen.queryByText(/A little more detail first/)).toBeNull();

    await fireEvent.press(screen.getByLabelText('Incident'));

    // ...and not enough as an incident report, which a supervisor has to act on.
    expect(screen.getByText(/A little more detail first/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('File incident report'));
    expect(care.addCareNote).not.toHaveBeenCalled();
  });

  it('files an incident with the right kind', async () => {
    await open();
    await fireEvent.press(screen.getByLabelText('Incident'));
    await fireEvent.changeText(
      screen.getByLabelText('Incident report details'),
      'At 15:10 she slipped getting out of the chair. No injury. Informed her son at 15:20.'
    );
    await fireEvent.press(screen.getByLabelText('File incident report'));

    await waitFor(() => expect(care.addCareNote).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'incident' })
    ));
  });

  it('does not throw away a draft when the sheet is dismissed by accident', async () => {
    await open();
    await fireEvent.changeText(screen.getByLabelText('Care note details'), 'Half a sentence so far');

    await fireEvent.press(screen.getAllByLabelText('Close')[0]);

    // Four sentences written standing in someone's kitchen are not lost to a
    // stray thumb.
    expect(screen.getByText('Discard what you have written?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Keep writing'));
    expect(screen.getByLabelText('Care note details').props.value).toBe('Half a sentence so far');
  });
});

describe('when there is nothing recorded', () => {
  it('says so per section rather than showing empty cards', async () => {
    care.recipient.mockResolvedValue({
      ...PERSON, medications: [], careNotes: [], emergencyContacts: [],
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByText('No emergency contacts')).toBeTruthy());
    expect(screen.getByText('No medications recorded')).toBeTruthy();
    expect(screen.getByText('No care notes yet')).toBeTruthy();
  });
});
