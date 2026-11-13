import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type } from '../theme/tokens';

/*
 * The tinted notices from the mockups: mint on registration, blue on sign-in,
 * amber on the step-up challenge, red when something failed.
 *
 * Each tone carries its own icon, and the icon is not decoration. Tone is
 * colour, and colour on its own fails WCAG 1.4.1 and fails the person who
 * cannot tell mint from amber -- the icon is what distinguishes "here is how
 * this works" from "something went wrong" without it.
 *
 * `role="error"` additionally announces itself: a failed registration has to
 * reach someone who is not looking at the top of the form when the response
 * lands.
 */
const TONES = {
  info: { bg: colors.infoBg, fg: colors.info, icon: 'information-circle' },
  success: { bg: colors.successBg, fg: colors.success, icon: 'shield-checkmark' },
  warning: { bg: colors.warningBg, fg: colors.warning, icon: 'warning' },
  error: { bg: colors.dangerBg, fg: colors.danger, icon: 'alert-circle' },
};

export default function Banner({ tone = 'info', children, title, style }) {
  const { bg, fg, icon } = TONES[tone] || TONES.info;
  const announce = tone === 'error' || tone === 'warning';

  return (
    <View
      style={[styles.wrap, { backgroundColor: bg }, style]}
      accessibilityLiveRegion={announce ? 'assertive' : 'none'}
      accessibilityRole={announce ? 'alert' : 'summary'}
    >
      <Ionicons name={icon} size={18} color={fg} style={styles.icon} />
      <View style={styles.body}>
        {title ? <Text style={[styles.title, { color: fg }]}>{title}</Text> : null}
        <Text style={[styles.text, { color: fg }]}>{children}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    borderRadius: radius.md,
    padding: space.lg,
  },
  // Nudged to sit on the first line of text rather than above it.
  icon: { marginTop: 1 },
  body: { flex: 1, gap: 2 },
  title: { ...type.captionMedium },
  text: { ...type.caption },
});
