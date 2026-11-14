import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import HeroHeader from '../components/HeroHeader';
import Banner from '../components/Banner';
import PrimaryButton from '../components/PrimaryButton';
import { useAuth } from '../auth/AuthContext';
import { colors, radius, shadow, space, type } from '../theme/tokens';

const ROLE_LABEL = { caregiver: 'Caregiver', family: 'Family member', administrator: 'Administrator' };

/*
 * The screen for an account the mobile app has no portal for.
 *
 * Since #45 a caregiver and a family member each get their own portal
 * (AppNavigator), so this is reached only by any other role -- in practice an
 * administrator, whose work is in the web console. It says so plainly rather
 * than showing an empty portal, and it signs out, which is the one useful
 * thing to do from here.
 *
 * It is also where a role the app does not recognise lands, if the service
 * ever adds one before the app does: a clear dead end with a way out, rather
 * than one portal's screens shown to an account that should not have them.
 */
export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      // Deliberately no setState here. A successful sign-out unmounts this
      // screen along with the rest of the app stack, so there is nothing left
      // to put back into a resting state.
    } catch {
      // signOut swallows a failed revoke and clears the session anyway, so
      // reaching this means something unexpected. Give the button back rather
      // than leaving it spinning on a screen that is still mounted.
      setSigningOut(false);
    }
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
      <HeroHeader
        brand="LindaCare"
        tagline="Kenya Caregiving Platform"
        title={user?.fullName ? `Hello, ${user.fullName.split(' ')[0]}` : 'Signed in'}
        subtitle={ROLE_LABEL[user?.role] || 'Account'}
      />

      <View style={styles.body}>
        <View style={styles.card}>
          <Text style={styles.heading}>This account works in the web console</Text>
          <Text style={styles.text}>
            The LindaCare app is for caregivers and family members. Administrator accounts
            manage the platform from the web console, which you can reach from a computer.
          </Text>
          {user?.accountStatus && user.accountStatus !== 'active' ? (
            <Text style={styles.status}>{`Account status: ${user.accountStatus}`}</Text>
          ) : null}
        </View>

        <Banner tone="info" title="Expected a different account?">
          If you are a caregiver or a family member and are seeing this, your account&rsquo;s
          role may have been changed. Sign out and contact your care agency.
        </Banner>

        <PrimaryButton
          label="Sign out"
          loadingLabel={'Signing out…'}
          loading={signingOut}
          onPress={onSignOut}
          accessibilityHint="Ends your session on this device and on the server"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.navy },
  scroll: { backgroundColor: colors.page, flexGrow: 1, paddingBottom: space.xxxl },
  body: { paddingHorizontal: space.xl, marginTop: -space.xl, gap: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.sm,
    ...shadow.card,
  },
  heading: { ...type.title, color: colors.ink },
  text: { ...type.body, color: colors.inkMuted },
  status: { ...type.captionMedium, color: colors.warning },
});
