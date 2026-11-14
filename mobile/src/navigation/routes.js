import { useCallback } from 'react';
import { usePortalChrome } from '../components/caregiver/PortalChrome';

/*
 * Getting to a screen, wherever it lives.
 *
 * Since #46 each portal is a stack with a bottom-tab navigator as its first
 * screen. A tab screen (Home, Assignments...) lives in the tab navigator; a
 * pushed screen (a care record, a visit report, the profile) lives in the
 * stack above it.
 *
 * React Navigation 7 will not reach *down* into a child navigator by name:
 * `navigate('Assignments')` from a care record -- a stack screen -- finds no
 * route called that in the stack and does nothing at all. No error in
 * production, no navigation either: a button that silently stops working.
 *
 * So destinations go through `goTo`, which knows from the portal definition
 * (portals.js) which screens are tabs, and addresses those through the tab
 * navigator: navigate('CaregiverTabs', { screen: 'Assignments' }). Calls from
 * one tab to another would work either way; routing them all through here
 * means nobody has to know which case they are in.
 *
 * There is a legacy switch on NavigationContainer that restores the old
 * reach-down behaviour. It is not used: it is deprecated, and it would also
 * let a screen name in one portal resolve against whatever navigator happened
 * to be nested below -- exactly the kind of loose resolution #45 and #46
 * spend their effort keeping the two portals out of.
 */

/** Navigate to `name` in `portal`, through the tab navigator if it is a tab. */
export function goTo(navigation, portal, name, params) {
  if (portal?.tabs?.includes(name)) {
    navigation.navigate(portal.tabsRoute, { screen: name, params });
  } else {
    navigation.navigate(name, params);
  }
}

/** The same, bound to the portal the calling screen is drawn inside. */
export function useGoTo(navigation) {
  const { portal } = usePortalChrome();
  return useCallback((name, params) => goTo(navigation, portal, name, params), [navigation, portal]);
}
