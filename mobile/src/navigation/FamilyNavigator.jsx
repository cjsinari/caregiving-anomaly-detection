import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import FamilyHomeScreen from '../screens/family/FamilyHomeScreen';
import CareUpdatesScreen from '../screens/family/CareUpdatesScreen';
import CarePlanScreen from '../screens/family/CarePlanScreen';
import ScheduleScreen from '../screens/family/ScheduleScreen';
import NotificationsScreen from '../screens/family/NotificationsScreen';
import AccountScreen from '../screens/account/AccountScreen';
import ProfileScreen from '../screens/account/ProfileScreen';
import ChangePhoneScreen from '../screens/account/ChangePhoneScreen';
import { PortalChromeProvider } from '../components/caregiver/PortalChrome';
import PortalTabBar from '../components/caregiver/PortalTabBar';
import { FamilyProvider } from '../family/FamilyContext';
import { colors } from '../theme/tokens';
import { FAMILY_PORTAL } from './portals';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

/*
 * The family app.
 *
 * The same shape as the caregiver portal (see CaregiverNavigator): a stack
 * whose first screen is the tab bar. Five tabs -- Home, Updates, Care Plan,
 * Schedule, Account -- and everything else pushed over them: the notification
 * list, reached from the bell on Home, and the profile screens.
 *
 * Route names stay distinct from the caregiver portal's (FamilyHome, not
 * Home), so a stray cross-portal `navigate` fails loudly in development rather
 * than landing somewhere plausible. Account, Profile and ChangePhone are the
 * same screens in both portals -- they are about the person, not the role --
 * and exist in whichever single portal AppNavigator mounts.
 *
 * FamilyProvider sits above the stack so the chosen loved one is shared by
 * every screen, tabs and pushed screens alike.
 */
function FamilyTabs() {
  return (
    <Tabs.Navigator
      tabBar={(props) => <PortalTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}
    >
      <Tabs.Screen name="FamilyHome" component={FamilyHomeScreen} />
      <Tabs.Screen name="CareUpdates" component={CareUpdatesScreen} />
      <Tabs.Screen name="CarePlan" component={CarePlanScreen} />
      <Tabs.Screen name="Schedule" component={ScheduleScreen} />
      <Tabs.Screen name="Account" component={AccountScreen} />
    </Tabs.Navigator>
  );
}

export default function FamilyNavigator() {
  return (
    <FamilyProvider>
      <PortalChromeProvider portal={FAMILY_PORTAL}>
        <Stack.Navigator
          initialRouteName={FAMILY_PORTAL.tabsRoute}
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.page },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name={FAMILY_PORTAL.tabsRoute} component={FamilyTabs} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
          <Stack.Screen name="ChangePhone" component={ChangePhoneScreen} />
        </Stack.Navigator>
      </PortalChromeProvider>
    </FamilyProvider>
  );
}
