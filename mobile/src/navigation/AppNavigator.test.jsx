import { act, render, waitFor, screen } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './AppNavigator';
import { AuthProvider } from '../auth/AuthContext';
import * as session from '../auth/session';
import { auth } from '../api/endpoints';
import { care } from '../api/caregiver';
import { family } from '../api/family';

/*
 * Two of issue #45's acceptance criteria, end to end:
 *
 *   "A caregiver can never reach family screens, and the reverse."
 *   "Role changes on the server take effect after the next token refresh."
 *
 * Everything real except the network: the AuthProvider, the session layer and
 * its keychain write, the navigators. The role change arrives the way it does
 * in production -- as a rotated access token whose payload names a new role --
 * so this fails if any link in that chain (decode, store, notify, re-render,
 * remount) is broken.
 *
 * "Never reach" is tested as "the routes do not exist", not as "the button is
 * not shown". The second can be got round by any code path that calls
 * navigate(); the first cannot.
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
jest.mock('expo-crypto', () => ({ randomUUID: () => 'device-under-test' }));
jest.mock('../api/endpoints', () => ({
  auth: { me: jest.fn(), logout: jest.fn() },
  account: {
    getPreferences: jest.fn(async () => ({ preferences: { push: true, categories: [], alwaysOn: ['account'] } })),
    updatePreferences: jest.fn(),
    registerPushToken: jest.fn(),
    unregisterPushToken: jest.fn(),
  },
}));
jest.mock('../api/caregiver', () => ({ care: { dashboard: jest.fn() } }));
jest.mock('../api/family', () => ({
  family: {
    recipients: jest.fn(),
    overview: jest.fn(),
  },
}));

const SecureStore = require('expo-secure-store');

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenWith = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;

// Names that exist in only one portal. Account, Profile and ChangePhone are
// in both (they are about the person, not the role) and so are not listed.
const CAREGIVER_ROUTES = ['CaregiverTabs', 'CaregiverHome', 'Assignments', 'RecipientDetail', 'NewReport', 'VisitReport'];
const FAMILY_ROUTES = ['FamilyTabs', 'FamilyHome', 'CareUpdates', 'CarePlan', 'Schedule', 'Notifications'];

const userAs = (role) => ({ id: 'user-1', fullName: 'Grace Wanjiru', role, accountStatus: 'active' });

let navRef;

const renderApp = async (role) => {
  SecureStore.__store.set('lindacare.session.v1', JSON.stringify({
    accessToken: tokenWith({ sub: 'user-1', role }),
    refreshToken: 'refresh-1',
    user: userAs(role),
  }));
  auth.me.mockResolvedValue(userAs(role));
  navRef = createNavigationContainerRef();

  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
};

/* Mounts the navigator only once restore has finished, as RootNavigator does. */
function Gate() {
  // eslint-disable-next-line global-require
  const { useAuth } = require('../auth/AuthContext');
  const { status } = useAuth();
  if (status !== 'signedIn') return null;
  return (
    <NavigationContainer ref={navRef}>
      <AppNavigator />
    </NavigationContainer>
  );
}

/*
 * Every route name the mounted app knows, across the stack and the tab
 * navigator nested in it (#46). "Cannot be reached" has to hold at every level,
 * not just at the root.
 */
const routeNames = () => {
  const names = new Set();
  const walk = (state) => {
    if (!state) return;
    (state.routeNames || []).forEach((n) => names.add(n));
    (state.routes || []).forEach((r) => walk(r.state));
  };
  walk(navRef.getRootState());
  return [...names];
};

beforeEach(() => {
  jest.clearAllMocks();
  SecureStore.__store.clear();
  session.__resetForTests();

  care.dashboard.mockResolvedValue({
    sessionRisk: null,
    counts: { assigned: 0, visitsToday: 0, completedToday: 0 },
    recipients: [],
    visits: [],
    alerts: [],
  });
  family.recipients.mockResolvedValue({
    recipients: [{ id: 'rec-001', fullName: 'Margaret Wanjiku', relationship: 'Mother', age: 78, status: 'stable' }],
  });
  family.overview.mockResolvedValue({
    recipient: { id: 'rec-001', fullName: 'Margaret Wanjiku', status: 'stable', statusNote: null },
    lastVisit: null,
    nextVisit: null,
    caregiver: null,
    latestUpdates: [],
    unreadNotifications: 0,
  });
});

describe('a caregiver', () => {
  it('gets the caregiver portal and no family route exists', async () => {
    await renderApp('caregiver');

    await waitFor(() => expect(routeNames()).toEqual(expect.arrayContaining(CAREGIVER_ROUTES)));
    FAMILY_ROUTES.forEach((name) => expect(routeNames()).not.toContain(name));
  });

  it('cannot navigate to a family screen even by name', async () => {
    await renderApp('caregiver');
    await waitFor(() => expect(navRef.isReady()).toBe(true));

    // What a stray deep link or notification tap would do. React Navigation
    // logs an unhandled-action error in development; the point is that the
    // current route does not change.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { navRef.navigate('CarePlan'); });
    spy.mockRestore();

    expect(navRef.getCurrentRoute()?.name).toBe('CaregiverHome');
    expect(family.recipients).not.toHaveBeenCalled();
  });
});

describe('a family member', () => {
  it('gets the family portal and no caregiver route exists', async () => {
    await renderApp('family');

    await waitFor(() => expect(routeNames()).toEqual(expect.arrayContaining(FAMILY_ROUTES)));
    CAREGIVER_ROUTES.forEach((name) => expect(routeNames()).not.toContain(name));
    // And no caregiver data was ever asked for.
    expect(care.dashboard).not.toHaveBeenCalled();
  });

  it('cannot navigate to a caregiver screen even by name', async () => {
    await renderApp('family');
    await waitFor(() => expect(navRef.isReady()).toBe(true));

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { navRef.navigate('VisitReport', { recipientId: 'rec-001' }); });
    spy.mockRestore();

    expect(navRef.getCurrentRoute()?.name).toBe('FamilyHome');
  });
});

describe('the role comes from the access token (#46)', () => {
  it('follows the token claim when the stored profile disagrees', async () => {
    // A profile cached before a role change, and a token issued after it.
    SecureStore.__store.set('lindacare.session.v1', JSON.stringify({
      accessToken: tokenWith({ sub: 'user-1', role: 'family' }),
      refreshToken: 'refresh-1',
      user: userAs('caregiver'),
    }));
    // /auth/me is offline, so the cached profile -- with the old role -- is
    // all the app has besides the token.
    const { ApiError } = jest.requireActual('../api/client');
    auth.me.mockRejectedValue(new ApiError('offline', { code: 'NETWORK' }));
    navRef = createNavigationContainerRef();
    await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <AuthProvider><Gate /></AuthProvider>
      </SafeAreaProvider>
    );

    // The service will authorise as family until the next refresh, so the
    // family portal is the one that can work.
    await waitFor(() => expect(routeNames()).toContain('FamilyHome'));
    CAREGIVER_ROUTES.forEach((name) => expect(routeNames()).not.toContain(name));
  });

  it('opens on the tabs, with every tab of the role present', async () => {
    await renderApp('caregiver');
    await waitFor(() => expect(routeNames()).toEqual(
      expect.arrayContaining(['CaregiverTabs', 'CaregiverHome', 'Assignments', 'NewReport', 'Account'])
    ));
    expect(navRef.getCurrentRoute()?.name).toBe('CaregiverHome');
  });
});

describe('any other role', () => {
  it('gets neither portal, and is told where to go instead', async () => {
    await renderApp('administrator');

    await waitFor(() => expect(screen.getByText('This account works in the web console')).toBeTruthy());
    [...CAREGIVER_ROUTES, ...FAMILY_ROUTES].forEach((name) => expect(routeNames()).not.toContain(name));
  });
});

describe('a role change on the server', () => {
  it('swaps the portal on the next token refresh, with no relaunch', async () => {
    await renderApp('caregiver');
    await waitFor(() => expect(routeNames()).toContain('CaregiverHome'));

    // What api/client.js does after a successful POST /auth/refresh: the
    // service signed the new token from the users row as it is now.
    await act(async () => {
      await session.save({
        accessToken: tokenWith({ sub: 'user-1', role: 'family' }),
        refreshToken: 'refresh-2',
      });
    });

    await waitFor(() => expect(routeNames()).toContain('FamilyHome'));
    CAREGIVER_ROUTES.forEach((name) => expect(routeNames()).not.toContain(name));
  });

  it('leaves no way back into the old portal', async () => {
    await renderApp('caregiver');
    await waitFor(() => expect(routeNames()).toContain('CaregiverHome'));

    await act(async () => {
      await session.save({ accessToken: tokenWith({ role: 'family' }), refreshToken: 'refresh-2' });
    });
    await waitFor(() => expect(routeNames()).toContain('FamilyHome'));

    // The old navigator is gone, history and all: there is nothing to go
    // back to.
    expect(navRef.canGoBack()).toBe(false);
  });

  it('is remembered, so the next offline launch opens the right portal', async () => {
    await renderApp('caregiver');
    await waitFor(() => expect(routeNames()).toContain('CaregiverHome'));

    await act(async () => {
      await session.save({ accessToken: tokenWith({ role: 'family' }), refreshToken: 'refresh-2' });
    });

    const stored = JSON.parse(SecureStore.__store.get('lindacare.session.v1'));
    expect(stored.user.role).toBe('family');
    // The rest of the profile survives the correction.
    expect(stored.user.fullName).toBe('Grace Wanjiru');
  });

  it('changes nothing when the refreshed token carries the same role', async () => {
    await renderApp('caregiver');
    await waitFor(() => expect(routeNames()).toContain('CaregiverHome'));
    const listener = jest.fn();
    const off = session.onUserChanged(listener);

    await act(async () => {
      await session.save({ accessToken: tokenWith({ role: 'caregiver' }), refreshToken: 'refresh-2' });
    });

    expect(listener).not.toHaveBeenCalled();
    expect(routeNames()).toContain('CaregiverHome');
    off();
  });

  it('ignores a refreshed token it cannot read, rather than signing anyone out', async () => {
    await renderApp('caregiver');
    await waitFor(() => expect(routeNames()).toContain('CaregiverHome'));

    await act(async () => {
      await session.save({ accessToken: 'opaque-not-a-jwt', refreshToken: 'refresh-2' });
    });

    expect(routeNames()).toContain('CaregiverHome');
  });
});
