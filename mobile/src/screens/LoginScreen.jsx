import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import HeroHeader from '../components/HeroHeader';
import Banner from '../components/Banner';
import { colors, radius, shadow, space, type } from '../theme/tokens';

/*
 * Welcome back: a placeholder.
 *
 * Sign-in is issue #42 -- the OTP request, encrypted token storage, the
 * refresh interceptor and session restore. The registration screen links here
 * ("Already have an account? Sign In"), so the destination has to exist for
 * that link to be anything other than a crash.
 */
export default function LoginScreen({ navigation }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
      <HeroHeader
        brand="LindaCare"
        tagline="Kenya Caregiving Platform"
        title="Welcome back"
        subtitle="Sign in with your registered phone number"
      />

      <View style={styles.body}>
        <Banner tone="info" title="Not built yet">
          Sign-in, token storage and session restore are issue #42.
        </Banner>

        <View style={styles.card}>
          <Text style={styles.text}>
            New to LindaCare?
          </Text>
          <Pressable
            onPress={() => navigation.navigate('Register')}
            hitSlop={10}
            accessibilityRole="link"
            accessibilityLabel="Create a new account"
          >
            <Text style={styles.link}>Create account</Text>
          </Pressable>
        </View>
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
    gap: space.xs,
    alignItems: 'center',
    ...shadow.card,
  },
  text: { ...type.body, color: colors.inkMuted },
  link: { ...type.button, color: colors.link },
});
