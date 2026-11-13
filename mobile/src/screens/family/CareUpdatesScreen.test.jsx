import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import CareUpdatesScreen from './CareUpdatesScreen';
import { FamilyProvider } from '../../family/FamilyContext';
import { PortalChromeProvider } from '../../components/caregiver/PortalChrome';
import { FAMILY_PORTAL } from '../../navigation/portals';
import { family } from '../../api/family';

/*
 * The care updates feed, item 2 of issue #45: pull-to-refresh and infinite
 * scroll, driven through the same events a finger produces -- a scroll that
 * reaches the end, a pull on the refresh control -- rather than by calling the
 * hook directly. usePagedFeed.test.js holds the edge cases; this holds that
 * the screen is actually wired to them.
 */

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'whenUnlocked',
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('../../api/family', () => ({
  family: { recipients: jest.fn(), updates: jest.fn() },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', fullName: 'Peter Wanjiku', role: 'family' } }),
}));

const navigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => false };

const visit = (n) => ({
  id: `u${n}`,
  kind: 'visit',
  at: new Date(Date.now() - n * 3600 * 1000).toISOString(),
  title: `Visit ${n}`,
  body: `Report ${n}`,
  author: 'Grace Wanjiru',
  visit: { wellbeing: 'well', tasksDone: 5, tasksTotal: 5, checkInAt: null, checkOutAt: null },
});
const page = (from, to, next) => ({
  items: Array.from({ length: to - from + 1 }, (_, i) => visit(from + i)),
  nextCursor: next,
});

const INCIDENT = {
  id: 'inc-1',
  kind: 'incident',
  at: new Date().toISOString(),
  title: 'Incident reported',
  body: 'She slipped getting out of the chair. No injury. Her son was informed.',
  author: 'Grace Wanjiru',
};

const launch = async () => render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 47, left: 0, right: 0, bottom: 34 },
    }}
  >
    <FamilyProvider>
      <PortalChromeProvider portal={FAMILY_PORTAL}>
        <CareUpdatesScreen navigation={navigation} />
      </PortalChromeProvider>
    </FamilyProvider>
  </SafeAreaProvider>
);

/*
 * A scroll that lands at the bottom of the list, as a finger would.
 *
 * The list first has to be told how big it is and how big its content is --
 * on a device that comes from layout, which a test renderer never performs --
 * or it cannot work out that the offset it is given is "the end".
 */
const scrollToEnd = async () => {
  const list = screen.getByTestId('care-updates-feed');
  await fireEvent(list, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 800 } } });
  await fireEvent(list, 'contentSizeChange', 390, 4200);
  await fireEvent.scroll(list, {
    nativeEvent: {
      contentOffset: { x: 0, y: 3400 },
      contentSize: { width: 390, height: 4200 },
      layoutMeasurement: { width: 390, height: 800 },
    },
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks leaves a queued mock*Once in place; a test that queued one
  // and never consumed it would hand it to the next test's first call.
  family.updates.mockReset();
  family.recipients.mockResolvedValue({
    recipients: [{ id: 'rec-001', fullName: 'Margaret Wanjiku', relationship: 'Mother', status: 'stable' }],
  });
  family.updates.mockImplementation(async ({ cursor }) => {
    if (!cursor) return page(1, 10, 'u10');
    if (cursor === 'u10') return page(11, 20, 'u20');
    return page(21, 24, null);
  });
});

describe('the feed', () => {
  it('shows the first page for the selected loved one', async () => {
    await launch();

    await waitFor(() => expect(screen.getByText('Visit 1')).toBeTruthy());
    expect(family.updates).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'rec-001', cursor: null, kind: null })
    );
  });

  it('loads the next page when the list is scrolled to the end', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Visit 1')).toBeTruthy());

    await scrollToEnd();

    await waitFor(() => expect(family.updates).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'u10' })
    ));
  });

  it('says so when it reaches the beginning of the record', async () => {
    family.updates.mockResolvedValue(page(1, 3, null));

    await launch();

    await waitFor(() => expect(screen.getByText('That is everything recorded so far.')).toBeTruthy());
  });

  it('keeps what is on screen and offers a retry when a later page fails', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Visit 1')).toBeTruthy());

    family.updates.mockRejectedValueOnce(new Error('Lost signal'));
    await scrollToEnd();

    await waitFor(() => expect(screen.getByText('Lost signal')).toBeTruthy());
    expect(screen.getByText('Visit 1')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(family.updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'u10' })
    ));
  });
});

describe('pull to refresh', () => {
  it('fetches the first page again and shows what is new', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Visit 1')).toBeTruthy());

    family.updates.mockResolvedValueOnce({ items: [{ ...visit(0), title: 'Just filed' }], nextCursor: null });
    // The test renderer's RefreshControl is a bare placeholder that keeps no
    // props, so the pull is delivered the way the native control delivers it:
    // by calling the onRefresh the list was given.
    await act(async () => {
      screen.getByTestId('care-updates-feed').props.refreshControl.props.onRefresh();
    });

    await waitFor(() => expect(screen.getByText('Just filed')).toBeTruthy());
  });
});

describe('filters', () => {
  it('asks the service for incidents rather than hiding what is loaded', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Visit 1')).toBeTruthy());

    family.updates.mockResolvedValue({ items: [INCIDENT], nextCursor: null });
    await fireEvent.press(screen.getByLabelText('Incidents'));

    await waitFor(() => expect(screen.getByText('Incident reported')).toBeTruthy());
    expect(family.updates).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'incident', cursor: null })
    );
    expect(screen.queryByText('Visit 1')).toBeNull();
  });

  it('reassures rather than alarms when there has never been an incident', async () => {
    await launch();
    await waitFor(() => expect(screen.getByText('Visit 1')).toBeTruthy());

    family.updates.mockResolvedValue({ items: [], nextCursor: null });
    await fireEvent.press(screen.getByLabelText('Incidents'));

    await waitFor(() => expect(screen.getByText('No incidents recorded')).toBeTruthy());
  });
});

describe('an incident in the feed', () => {
  it('is never cut short', async () => {
    family.updates.mockResolvedValue({ items: [INCIDENT, visit(1)], nextCursor: null });

    await launch();

    await waitFor(() => expect(screen.getByText(INCIDENT.body)).toBeTruthy());
    expect(screen.getByText(INCIDENT.body).props.numberOfLines).toBeUndefined();
    expect(screen.getByLabelText(/^Incident\. Incident reported/)).toBeTruthy();
  });
});

describe('the first load', () => {
  it('shows a skeleton, then the feed', async () => {
    let release;
    family.updates.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    await launch();
    await waitFor(() => expect(screen.getAllByLabelText('Loading').length).toBeGreaterThan(0));

    await act(async () => { release(page(1, 2, null)); });
    await waitFor(() => expect(screen.getByText('Visit 1')).toBeTruthy());
  });

  it('takes the screen with an error only when nothing has loaded', async () => {
    family.updates.mockRejectedValueOnce(new Error('The care service is not responding.'));

    await launch();

    await waitFor(() => expect(screen.getByText('Could not load the updates')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.getByText('Visit 1')).toBeTruthy());
  });
});
