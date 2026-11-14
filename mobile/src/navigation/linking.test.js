import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { buildLinking, refusalFor, rolesFor } from './linking';
import { goTo } from './routes';
import { CAREGIVER_PORTAL, FAMILY_PORTAL } from './portals';

/*
 * Item 5 of issue #46: "guard against deep links into the wrong role's
 * screens".
 *
 * The guard is tested at the point every link passes through --
 * getStateFromPath -- and for both of the ways a link arrives: a URL opened
 * from outside, and the url a tapped push notification carries. A guard that
 * covered one and not the other would be a guard with a door beside it.
 */

const resolvedRoute = (state) => {
  let route = state?.routes?.[state.routes.length - 1];
  while (route?.state) route = route.state.routes[route.state.routes.length - 1];
  return route;
};

describe('which portal a path belongs to', () => {
  it('knows the caregiver-only paths', () => {
    expect(rolesFor('recipients/rec-001')).toEqual(['caregiver']);
    expect(rolesFor('visits/v1/report')).toEqual(['caregiver']);
    expect(rolesFor('assignments')).toEqual(['caregiver']);
  });

  it('knows the family-only paths', () => {
    expect(rolesFor('updates')).toEqual(['family']);
    expect(rolesFor('care-plan')).toEqual(['family']);
    expect(rolesFor('notifications')).toEqual(['family']);
  });

  it('lets a shared path resolve in both', () => {
    expect(rolesFor('home').sort()).toEqual(['caregiver', 'family']);
    expect(rolesFor('account/profile').sort()).toEqual(['caregiver', 'family']);
  });
});

describe('the guard', () => {
  it('opens a caregiver link for a caregiver', () => {
    const linking = buildLinking({ role: 'caregiver', onRefused: jest.fn() });
    const route = resolvedRoute(linking.getStateFromPath('recipients/rec-001', linking.config));
    expect(route).toMatchObject({ name: 'RecipientDetail', params: { recipientId: 'rec-001' } });
  });

  it('refuses a caregiver link for a family member, and says why', () => {
    const onRefused = jest.fn();
    const linking = buildLinking({ role: 'family', onRefused });

    expect(linking.getStateFromPath('recipients/rec-001', linking.config)).toBeUndefined();
    expect(onRefused).toHaveBeenCalledWith(
      'That link is for a caregiver account, so it cannot be opened here.'
    );
  });

  it('refuses a family link for a caregiver', () => {
    const onRefused = jest.fn();
    const linking = buildLinking({ role: 'caregiver', onRefused });

    expect(linking.getStateFromPath('care-plan', linking.config)).toBeUndefined();
    expect(onRefused).toHaveBeenCalledWith(
      'That link is for a family member account, so it cannot be opened here.'
    );
  });

  it('sends a shared link to the opener’s own screen', () => {
    const caregiver = buildLinking({ role: 'caregiver' });
    const family = buildLinking({ role: 'family' });
    expect(resolvedRoute(caregiver.getStateFromPath('home', caregiver.config)).name).toBe('CaregiverHome');
    expect(resolvedRoute(family.getStateFromPath('home', family.config)).name).toBe('FamilyHome');
  });

  it('opens nothing for someone signed out, and says to sign in', () => {
    const onRefused = jest.fn();
    const linking = buildLinking({ role: null, onRefused });

    expect(linking.getStateFromPath('recipients/rec-001', linking.config)).toBeUndefined();
    expect(onRefused).toHaveBeenCalledWith('Sign in first, then open the link again.');
  });

  it('ignores a path that is nobody’s, without a notice', () => {
    const onRefused = jest.fn();
    const linking = buildLinking({ role: 'family', onRefused });

    expect(linking.getStateFromPath('admin/accounts', linking.config)).toBeUndefined();
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('gives an administrator neither portal', () => {
    expect(refusalFor('home', 'administrator')).toMatch(/link is for a (caregiver|family member) account/);
  });
});

describe('links from push notifications go through the same guard', () => {
  it('feeds a tapped notification’s url to the same listener as any link', () => {
    let tap;
    Notifications.addNotificationResponseReceivedListener.mockImplementationOnce((fn) => {
      tap = fn;
      return { remove: jest.fn() };
    });
    const linkSpy = jest.spyOn(Linking, 'addEventListener').mockReturnValue({ remove: jest.fn() });

    const listener = jest.fn();
    const unsubscribe = buildLinking({ role: 'family' }).subscribe(listener);
    tap({ notification: { request: { content: { data: { url: 'lindacare://recipients/rec-001' } } } } });

    // Delivered to the navigator's listener, which runs getStateFromPath --
    // and so the guard -- on it like any other URL.
    expect(listener).toHaveBeenCalledWith('lindacare://recipients/rec-001');
    unsubscribe();
    linkSpy.mockRestore();
  });

  it('ignores a notification with no url', () => {
    let tap;
    Notifications.addNotificationResponseReceivedListener.mockImplementationOnce((fn) => {
      tap = fn;
      return { remove: jest.fn() };
    });
    jest.spyOn(Linking, 'addEventListener').mockReturnValue({ remove: jest.fn() });

    const listener = jest.fn();
    buildLinking({ role: 'family' }).subscribe(listener);
    tap({ notification: { request: { content: { data: {} } } } });

    expect(listener).not.toHaveBeenCalled();
  });

  it('opens the app on the notification that launched it', async () => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
    Notifications.getLastNotificationResponseAsync.mockResolvedValueOnce({
      notification: { request: { content: { data: { url: 'lindacare://updates' } } } },
    });

    await expect(buildLinking({ role: 'family' }).getInitialURL()).resolves.toBe('lindacare://updates');
  });
});

describe('goTo', () => {
  it('reaches a tab through the tab navigator', () => {
    const navigation = { navigate: jest.fn() };
    goTo(navigation, CAREGIVER_PORTAL, 'Assignments');
    expect(navigation.navigate).toHaveBeenCalledWith('CaregiverTabs', { screen: 'Assignments', params: undefined });
  });

  it('pushes a stack screen by name', () => {
    const navigation = { navigate: jest.fn() };
    goTo(navigation, FAMILY_PORTAL, 'Notifications');
    expect(navigation.navigate).toHaveBeenCalledWith('Notifications', undefined);
  });

  it('carries params through to the tab', () => {
    const navigation = { navigate: jest.fn() };
    goTo(navigation, CAREGIVER_PORTAL, 'CaregiverHome', { filed: 'Margaret' });
    expect(navigation.navigate).toHaveBeenCalledWith('CaregiverTabs', {
      screen: 'CaregiverHome', params: { filed: 'Margaret' },
    });
  });
});
