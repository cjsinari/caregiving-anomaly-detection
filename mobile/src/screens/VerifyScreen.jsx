import { ScrollView, StyleSheet, Text, View } from 'react-native';
import HeroHeader from '../components/HeroHeader';
import Banner from '../components/Banner';
import { colors, radius, shadow, space, type } from '../theme/tokens';

/*
 * Verify phone: a placeholder.
 *
 * Issue #41 ends at "route to the verification screen on success", and the
 * screen itself -- the six-digit input, the resend cooldown, the attempt-limit
 * feedback -- is issue #43. This exists so that the end of registration goes
 * somewhere real and the hand-off can be tested, rather than leaving a
 * navigation call pointing at nothing.
 *
 * It deliberately does not call the service. A half-built OTP screen that
 * consumes real attempts against a real rate limit is worse than an honest
 * placeholder.
 */
export default function VerifyScreen({ route, navigation }) {
  const { phoneNumber, fullName } = route.params || {};

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
      <HeroHeader
        icon="phone-portrait-outline"
        title="Verify Phone"
        subtitle={phoneNumber
          ? `Enter the 6-digit code sent to ${phoneNumber}`
          : 'Enter the 6-digit code we sent you'}
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />

      <View style={styles.body}>
        <View style={styles.card}>
          <Text style={styles.heading}>Registration started</Text>
          <Text style={styles.text}>
            {fullName ? `Thanks, ${fullName.split(' ')[0]}. ` : ''}
            Your account is pending and a verification code is on its way to{' '}
            <Text style={styles.strong}>{phoneNumber}</Text>.
          </Text>
        </View>

        <Banner tone="info" title="Not built yet">
          The six-digit code entry, resend timer and attempt limits are issue #43.
          This screen confirms registration reached the service and the hand-off works.
        </Banner>
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
  strong: { fontFamily: type.bodyMedium.fontFamily, color: colors.ink },
});
