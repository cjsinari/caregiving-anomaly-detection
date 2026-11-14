import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CaregiverNavigator from './CaregiverNavigator';
import FamilyNavigator from './FamilyNavigator';
import HomeScreen from '../screens/HomeScreen';
import { AccountProvider } from '../account/AccountContext';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme/tokens';

const Stack = createNativeStackNavigator();

/*
 * The signed-in app: one portal per role, and only ever one.
 *
 * Issue #45: "a caregiver can never reach family screens, and the reverse."
 *
 * ── Enforced by construction ──
 *
 * The obvious build is one stack holding both portals' screens, with the home
 * screen chosen by role. That version is wrong in a way no amount of care
 * fixes: every screen of both portals is *registered*, so anything that calls
 * `navigate` with the other portal's route name -- a deep link, a push
 * notification tap, a stray line in a later issue -- gets there. Each such
 * path needs its own guard, and the first one somebody forgets is the breach.
 *
 * Here the role chooses which navigator exists. A caregiver's app does not
 * contain the family screens at all; there is no route to reach and no guard
 * to forget. The same argument RootNavigator makes for signed-out versus
 * signed-in, applied one level down.
 *
 * ── A role that changes while the app is open ──
 *
 * "Role changes on the server take effect after the next token refresh."
 * The refreshed token carries the new role, session.save reads it, and
 * AuthContext updates `user` (see tokenClaims.js). This component then
 * re-renders with the other branch, and React unmounts the old navigator
 * outright -- its screens and its history go with it, so the back gesture
 * cannot walk into the portal the person no longer has.
 *
 * ── What this is not ──
 *
 * Which portal is decided by the role in the access token (#46): the claim
 * the service itself authorises every request with.
 *
 * It is the choice of which screens to mount, not authorization. Every
 * request still carries the token, and the service scopes every answer by the
 * role in it (ownership.js, resourceAccess.js). A tampered client that mounted
 * the wrong portal would get empty screens and 403s, not data.
 *
 * Any other role -- an administrator -- gets the holding screen, which says
 * the web console is where that account works.
 */
export default function AppNavigator() {
  // The access token's role claim (#46), with the stored profile's role as the
  // fallback for a token the app cannot read. See AuthContext.
  const { role } = useAuth();

  /*
   * AccountProvider wraps the portal, keyed by role with it, so a role change
   * starts the account state afresh along with the screens: a caregiver's
   * notification categories must not survive into a family portal.
   */
  if (role === 'caregiver') {
    return <AccountProvider key="caregiver"><CaregiverNavigator /></AccountProvider>;
  }
  if (role === 'family') {
    return <AccountProvider key="family"><FamilyNavigator /></AccountProvider>;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.page },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}
