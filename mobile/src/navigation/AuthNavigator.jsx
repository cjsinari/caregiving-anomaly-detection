import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RegisterScreen from '../screens/RegisterScreen';
import VerifyScreen from '../screens/VerifyScreen';
import LoginScreen from '../screens/LoginScreen';
import RecoveryScreen from '../screens/RecoveryScreen';
import { colors } from '../theme/tokens';

const Stack = createNativeStackNavigator();

/*
 * The screens a signed-out person can reach.
 *
 * Headers are off throughout: every screen in this flow draws its own navy
 * hero, and a stack header above it would be a second title bar in a
 * different colour.
 *
 * Sign-in is the entry point, because most people opening the app already have
 * an account; registration is one tap away from it. Session restore happens in
 * front of this stack rather than inside it -- see RootNavigator, which mounts
 * this only once there is known to be no session.
 */
export default function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.page },
        // The navy hero runs to the top of the screen, so the transition
        // should not flash the page colour behind it.
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} />
      <Stack.Screen name="Verify" component={VerifyScreen} />
      <Stack.Screen name="Recovery" component={RecoveryScreen} />
    </Stack.Navigator>
  );
}
