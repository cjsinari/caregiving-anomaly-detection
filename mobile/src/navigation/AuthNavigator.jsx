import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RegisterScreen from '../screens/RegisterScreen';
import VerifyScreen from '../screens/VerifyScreen';
import LoginScreen from '../screens/LoginScreen';
import { colors } from '../theme/tokens';

const Stack = createNativeStackNavigator();

/*
 * The screens a signed-out person can reach.
 *
 * Headers are off throughout: every screen in this flow draws its own navy
 * hero, and a stack header above it would be a second title bar in a
 * different colour.
 *
 * Registration is the initial route only because it is what issue #41 builds.
 * Issue #42 makes sign-in the entry point and puts session restore in front of
 * both, at which point this becomes one half of a root navigator that chooses
 * between the auth stack and a role-specific one.
 */
export default function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Register"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.page },
        // The navy hero runs to the top of the screen, so the transition
        // should not flash the page colour behind it.
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}
