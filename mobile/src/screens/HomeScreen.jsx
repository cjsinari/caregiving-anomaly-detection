import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import HeroHeader from '../components/HeroHeader';
import Banner from '../components/Banner';
import PrimaryButton from '../components/PrimaryButton';
import { useAuth } from '../auth/AuthContext';
import { colors, radius, shadow, space, type } from '../theme/tokens';

const ROLE_LABEL = { caregiver: 'Caregiver', family: 'Family member' };

/*
 * The first screen behind the sign-in, and the last thing issue #42 owes.
 *
 * It is a holding screen, not a home screen. Since #44 it is reached only by
 * a family member -- AppNavigator sends a caregiver to the caregiver stack --
 * and #45 replaces it with the family view. What it does do is real, and is
 * what makes the
 * session work verifiable by hand rather than only in tests -- it shows who
 * the restored session belongs to, straight from the service, and it signs
 * out.
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
          <Text style={styles.heading}>You are signed in</Text>
          <Text style={styles.text}>
            Your session is stored in this device&rsquo;s keychain and will still be here the
            next time you open the app.
          </Text>
          {user?.accountStatus && user.accountStatus !== 'active' ? (
            <Text style={styles.status}>{`Account status: ${user.accountStatus}`}</Text>
          ) : null}
        </View>

        <Banner tone="info" title="Still to come">
          The family member screens are issue #45, and the shared profile and settings
          screens are #46. The caregiver screens (#44) are built; signing in with a
          caregiver account opens them instead of this page.
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
