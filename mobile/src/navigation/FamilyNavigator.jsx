import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FamilyHomeScreen from '../screens/family/FamilyHomeScreen';
import CareUpdatesScreen from '../screens/family/CareUpdatesScreen';
import CarePlanScreen from '../screens/family/CarePlanScreen';
import ScheduleScreen from '../screens/family/ScheduleScreen';
import NotificationsScreen from '../screens/family/NotificationsScreen';
import { PortalChromeProvider } from '../components/caregiver/PortalChrome';
import { FamilyProvider } from '../family/FamilyContext';
import { colors } from '../theme/tokens';
import { FAMILY_PORTAL } from './portals';

const Stack = createNativeStackNavigator();

/*
 * The family app: issue #45.
 *
 * Five screens, all of them for reading. The same frame as the caregiver
 * portal -- one sidebar, one top bar, collapsible the same way -- because it
 * is one app and someone who has seen one portal should not have to learn the
 * other. What differs is handed in as FAMILY_PORTAL: the heading, the role
 * label, and destinations that exist only here.
 *
 * Route names are distinct from the caregiver portal's on purpose
 * (FamilyHome, not Home). Nothing should be able to navigate across portals,
 * and AppNavigator guarantees that by mounting only one; distinct names mean
 * a stray `navigate('Assignments')` from a family screen fails loudly in
 * development instead of quietly landing somewhere plausible.
 *
 * FamilyProvider sits above the stack so the chosen loved one and the family
 * member's settings are shared by every screen (see FamilyContext).
 */
export default function FamilyNavigator() {
  return (
    <FamilyProvider>
      <PortalChromeProvider portal={FAMILY_PORTAL}>
        <Stack.Navigator
          initialRouteName="FamilyHome"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.page },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="FamilyHome" component={FamilyHomeScreen} />
          <Stack.Screen name="CareUpdates" component={CareUpdatesScreen} />
          <Stack.Screen name="CarePlan" component={CarePlanScreen} />
          <Stack.Screen name="Schedule" component={ScheduleScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
        </Stack.Navigator>
      </PortalChromeProvider>
    </FamilyProvider>
  );
}
