import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import CaregiverHomeScreen from '../screens/caregiver/CaregiverHomeScreen';
import AssignmentsScreen from '../screens/caregiver/AssignmentsScreen';
import RecipientDetailScreen from '../screens/caregiver/RecipientDetailScreen';
import VisitReportScreen from '../screens/caregiver/VisitReportScreen';
import NewReportScreen from '../screens/caregiver/NewReportScreen';
import AccountScreen from '../screens/account/AccountScreen';
import ProfileScreen from '../screens/account/ProfileScreen';
import ChangePhoneScreen from '../screens/account/ChangePhoneScreen';
import { PortalChromeProvider } from '../components/caregiver/PortalChrome';
import PortalTabBar from '../components/caregiver/PortalTabBar';
import { colors } from '../theme/tokens';
import { CAREGIVER_PORTAL } from './portals';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

/*
 * The caregiver app.
 *
 * ── Tabs for destinations, a stack for things you open ──
 *
 * #44 built this as one stack navigated from a sidebar. #46 asks for bottom
 * tabs, and the two fit together rather than compete:
 *
 *   the tabs are the four places a caregiver goes -- Home, Assignments, the
 *   report chooser, Account -- and keep their own scroll position and state,
 *   so switching to Assignments and back does not reload the day;
 *
 *   everything you *open* -- a care record, a visit report, the profile -- is
 *   pushed on the stack over the tabs, hiding the bar, and the back gesture
 *   closes it. A visit report with a tab bar under it invites a tap that
 *   abandons the report mid-sentence.
 *
 * The sidebar stays, and is the navigation on a wide screen, where the tab
 * bar draws nothing (PortalTabBar). On a phone it sits behind the menu button.
 *
 * Route names are unchanged from #44, so nothing that navigates by name had
 * to learn new ones; navigation/routes.js handles reaching a tab from a
 * pushed screen.
 */
function CaregiverTabs() {
  return (
    <Tabs.Navigator
      tabBar={(props) => <PortalTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}
    >
      <Tabs.Screen name="CaregiverHome" component={CaregiverHomeScreen} />
      <Tabs.Screen name="Assignments" component={AssignmentsScreen} />
      <Tabs.Screen name="NewReport" component={NewReportScreen} />
      <Tabs.Screen name="Account" component={AccountScreen} />
    </Tabs.Navigator>
  );
}

export default function CaregiverNavigator() {
  return (
    <PortalChromeProvider portal={CAREGIVER_PORTAL}>
      <Stack.Navigator
        initialRouteName={CAREGIVER_PORTAL.tabsRoute}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.page },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name={CAREGIVER_PORTAL.tabsRoute} component={CaregiverTabs} />
        <Stack.Screen name="RecipientDetail" component={RecipientDetailScreen} />
        {/*
         * A report is a sheet rather than a push: it is a task you complete
         * and dismiss, and the modal presentation makes the back gesture read
         * as "abandon this report" rather than "go up a level".
         */}
        <Stack.Screen
          name="VisitReport"
          component={VisitReportScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="ChangePhone" component={ChangePhoneScreen} />
      </Stack.Navigator>
    </PortalChromeProvider>
  );
}
