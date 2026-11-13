import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CaregiverHomeScreen from '../screens/caregiver/CaregiverHomeScreen';
import AssignmentsScreen from '../screens/caregiver/AssignmentsScreen';
import RecipientDetailScreen from '../screens/caregiver/RecipientDetailScreen';
import VisitReportScreen from '../screens/caregiver/VisitReportScreen';
import NewReportScreen from '../screens/caregiver/NewReportScreen';
import { PortalChromeProvider } from '../components/caregiver/PortalChrome';
import { colors } from '../theme/tokens';

const Stack = createNativeStackNavigator();

/*
 * The caregiver app: issue #44.
 *
 * ── Why a stack and not tabs ──
 *
 * The approved mockups navigate from a sidebar, and these five screens are not
 * five peers. Home, Assignments and the report chooser are destinations; a
 * care record and a visit report are things you open *from* one of them and
 * then close. A tab bar flattens that distinction and then has to invent an
 * answer for where a care record lives, which is usually "a fourth tab that is
 * empty until you tap something".
 *
 * A stack keeps the hierarchy honest: the sidebar switches destinations, the
 * back gesture closes what was opened, and the three destinations behave like
 * tabs because `navigate` returns to an existing screen rather than pushing a
 * second copy of it.
 *
 * ── The chrome provider wraps the navigator, not each screen ──
 *
 * So the sidebar's open/closed state outlives a screen change. See
 * PortalChrome for why a sidebar that shuts itself every time you use it is
 * the failure mode this avoids.
 *
 * ── Headers are off ──
 *
 * Every screen draws PortalShell's own bar, which carries the sidebar toggle
 * and the service status. A native stack header above it would be a second
 * title bar saying the same word.
 */
export default function CaregiverNavigator() {
  return (
    <PortalChromeProvider>
      <Stack.Navigator
        initialRouteName="CaregiverHome"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.page },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="CaregiverHome" component={CaregiverHomeScreen} />
        <Stack.Screen name="Assignments" component={AssignmentsScreen} />
        <Stack.Screen name="RecipientDetail" component={RecipientDetailScreen} />
        <Stack.Screen name="NewReport" component={NewReportScreen} />
        {/*
         * A report is a sheet rather than a push: it is a task you complete
         * and dismiss, not a place you navigate to, and the modal presentation
         * is what makes the back gesture read as "abandon this report" instead
         * of "go up a level".
         */}
        <Stack.Screen
          name="VisitReport"
          component={VisitReportScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
      </Stack.Navigator>
    </PortalChromeProvider>
  );
}
