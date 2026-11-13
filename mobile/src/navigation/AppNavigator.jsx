import CaregiverNavigator from './CaregiverNavigator';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import { useAuth } from '../auth/AuthContext';
import { colors } from '../theme/tokens';

const Stack = createNativeStackNavigator();

/*
 * The signed-in app, split by role.
 *
 * #42 left one holding screen here with a note that #44 would add the
 * caregiver screens, #45 the family ones and #46 the role-based choice. #44
 * cannot land without *some* way to reach the screens it builds, so the choice
 * arrives early, in its smallest honest form: a caregiver gets the caregiver
 * stack, everyone else gets the holding screen they had before.
 *
 * This is deliberately not #46. That issue owns the real thing -- the family
 * stack beside this one, the shared profile and settings screens, and whatever
 * the two roles end up having in common. What is here is one branch on
 * `user.role`, which is the least that makes #44 reachable and the least for
 * #46 to unpick.
 *
 * ── Why the role is read from the session and not from a route param ──
 *
 * Because it decides which screens exist. A caregiver and a family member see
 * different data about different people, and a stack chosen by a parameter is
 * a stack that can be chosen wrongly. `user.role` comes from /auth/me on every
 * restore, so it is the service's answer, not the client's.
 *
 * Authorization still does not live here: the service scopes every response to
 * the account that asked (resourceAccess.js). This chooses which screens to
 * mount, which is a different question from what they are allowed to show.
 */
export default function AppNavigator() {
  const { user } = useAuth();

  if (user?.role === 'caregiver') return <CaregiverNavigator />;

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
