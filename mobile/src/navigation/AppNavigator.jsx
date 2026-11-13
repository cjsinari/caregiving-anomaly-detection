import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import { colors } from '../theme/tokens';

const Stack = createNativeStackNavigator();

/*
 * The signed-in app.
 *
 * One screen for now. The caregiver screens are issue #44, the family member
 * screens are #45, and #46 chooses between them by role and adds the tab bar,
 * the profile and the settings. What #42 needs from this stack is that it
 * exists and that it is only reachable with a session, which is what makes
 * session restore, logout and the expiry redirect testable rather than
 * theoretical.
 */
export default function AppNavigator() {
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
