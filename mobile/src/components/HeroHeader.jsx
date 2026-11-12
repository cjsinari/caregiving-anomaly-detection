import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space, type, TOUCH_TARGET } from '../theme/tokens';

/*
 * The navy header every screen in the auth flow opens with.
 *
 * Four variations appear across the mockups -- the wordmark and a title on
 * registration and sign-in, a back arrow and an icon tile on the verification
 * screens -- so this takes them as props rather than existing in four copies.
 * Issues #42 and #43 render the other two.
 *
 * ── The safe area ──
 *
 * The padding comes from `useSafeAreaInsets` rather than a SafeAreaView,
 * because the header's navy has to run up behind the status bar while its
 * *content* starts below it. A SafeAreaView would inset the background too and
 * leave a white band above the navy on any phone with a notch.
 */
export default function HeroHeader({
  title,
  subtitle,
  brand,
  tagline,
  icon,
  onBack,
  backLabel = 'Back',
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + space.md }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={styles.back}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
        >
          <Ionicons name="chevron-back" size={18} color={colors.onNavyMuted} />
          <Text style={styles.backText}>{backLabel}</Text>
        </Pressable>
      ) : null}

      {brand ? (
        <View style={styles.brandRow}>
          <View style={styles.mark}>
            <Ionicons name="shield-checkmark" size={20} color={colors.onTeal} />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.brandName}>{brand}</Text>
            {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
          </View>
        </View>
      ) : null}

      {icon && !brand ? (
        <View style={styles.mark}>
          <Ionicons name={icon} size={22} color={colors.onTeal} />
        </View>
      ) : null}

      {/* The title is the screen's heading for assistive tech, which is what
          lets a screen-reader user jump straight to it instead of walking the
          header's decoration first. */}
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.navy,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: TOUCH_TARGET - 12,
    alignSelf: 'flex-start',
    paddingRight: space.md,
  },
  backText: { ...type.caption, color: colors.onNavyMuted },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  brandText: { flex: 1 },
  brandName: { ...type.bodyMedium, fontFamily: type.button.fontFamily, color: colors.onNavy },
  tagline: { ...type.caption, fontSize: 12, color: colors.onNavyMuted },

  mark: {
    width: 42,
    height: 42,
    borderRadius: radius.md + 2,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },

  title: { ...type.hero, color: colors.onNavy, marginTop: space.sm },
  subtitle: { ...type.subtitle, color: colors.onNavyMuted, marginTop: -space.xs },
});
