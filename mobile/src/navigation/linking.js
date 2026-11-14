import { Linking } from 'react-native';
import { getStateFromPath as defaultGetStateFromPath } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';

/*
 * Deep links, and the guard that keeps each role inside its own portal (#46).
 *
 * ── Where links come from ──
 *
 * Two places, and both go through the same guard: a `lindacare://` URL
 * opened from outside the app (an SMS, a browser, another app), and the `url`
 * a push notification carries in its data, delivered when the notification
 * is tapped. A push that skipped the guard would be the easiest way round it,
 * so pushes are fed into the same `subscribe`/`getInitialURL` pipeline as any
 * other link rather than navigated by hand.
 *
 * ── The guard ──
 *
 * Each role has its own path map. A path is resolved against the signed-in
 * role's map only. If it is not there:
 *
 *   it belongs to the other portal  -- a caregiver opening a family link --
 *                                     nothing happens, and the app says why;
 *   nobody is signed in              -- nothing happens, and the app says to
 *                                     sign in first;
 *   it matches nothing at all        -- nothing happens.
 *
 * Returning nothing is the guard. It does not *try* the link and rely on the
 * navigator to refuse: the navigator would refuse (AppNavigator mounts only
 * one portal, so the route does not exist), but a link half-resolved into a
 * parent route with a missing child is how an app ends up on a blank screen.
 *
 * ── What a link cannot do ──
 *
 * Choose whose data a screen shows. A link to `recipients/rec-001` opens the
 * care record screen with that id; the screen then asks the service, which
 * answers only for someone on the caller's own caseload (resourceAccess.js)
 * and says "not found" otherwise. The guard decides which *screens* a link
 * may reach; the service decides what is *on* them.
 */

export const PREFIXES = ['lindacare://'];

/*
 * The path maps. Shared paths ("home", "account") resolve to each role's own
 * screen, so a generic link -- from an SMS sent to everyone -- lands somewhere
 * sensible for whoever opens it.
 */
export const PATHS = {
  caregiver: {
    screens: {
      CaregiverTabs: {
        screens: {
          CaregiverHome: 'home',
          Assignments: 'assignments',
          NewReport: 'reports/new',
          Account: 'account',
        },
      },
      RecipientDetail: 'recipients/:recipientId',
      VisitReport: 'visits/:visitId/report',
      Profile: 'account/profile',
      ChangePhone: 'account/phone',
    },
  },
  family: {
    screens: {
      FamilyTabs: {
        screens: {
          FamilyHome: 'home',
          CareUpdates: 'updates',
          CarePlan: 'care-plan',
          Schedule: 'schedule',
          Account: 'account',
        },
      },
      Notifications: 'notifications',
      Profile: 'account/profile',
      ChangePhone: 'account/phone',
    },
  },
};

const ROLE_LABEL = { caregiver: 'a caregiver', family: 'a family member' };

/** Which roles' maps a path resolves in. */
export function rolesFor(path) {
  return Object.keys(PATHS).filter((role) => Boolean(defaultGetStateFromPath(path, PATHS[role])));
}

/**
 * The notice to show for a refused link, or null for one that should open.
 * Exported for tests; buildLinking uses it.
 */
export function refusalFor(path, role) {
  if (role && PATHS[role] && defaultGetStateFromPath(path, PATHS[role])) return null;
  const owners = rolesFor(path);
  if (!owners.length) return null;           // matches nothing: ignored quietly
  if (!role) return 'Sign in first, then open the link again.';
  const owner = owners.find((r) => r !== role);
  if (!owner) return null;
  return `That link is for ${ROLE_LABEL[owner] || 'another kind of'} account, so it cannot be opened here.`;
}

/** The url a tapped push carries, if any. */
const urlFromResponse = (response) => {
  const url = response?.notification?.request?.content?.data?.url;
  return typeof url === 'string' ? url : null;
};

/**
 * The linking options for NavigationContainer, for the role signed in now.
 *
 * `onRefused(message)` is called when a link is refused, so the app can say
 * so -- a link that silently does nothing reads as the app being broken.
 */
export function buildLinking({ role, onRefused }) {
  const config = role ? PATHS[role] : undefined;

  return {
    prefixes: PREFIXES,
    config,

    getStateFromPath(path, options) {
      const message = refusalFor(path, role);
      if (message) {
        onRefused?.(message);
        return undefined;
      }
      if (!config) return undefined;
      return defaultGetStateFromPath(path, { ...options, ...config });
    },

    async getInitialURL() {
      const url = await Linking.getInitialURL();
      if (url) return url;
      // Launched by tapping a notification while the app was closed.
      try {
        return urlFromResponse(await Notifications.getLastNotificationResponseAsync());
      } catch {
        return null;
      }
    },

    subscribe(listener) {
      const links = Linking.addEventListener('url', ({ url }) => listener(url));
      const taps = Notifications.addNotificationResponseReceivedListener((response) => {
        const url = urlFromResponse(response);
        if (url) listener(url);
      });
      return () => {
        links.remove();
        taps.remove();
      };
    },
  };
}
