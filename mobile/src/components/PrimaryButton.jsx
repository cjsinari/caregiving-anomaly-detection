import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type, TOUCH_TARGET } from '../theme/tokens';

/*
 * The teal action button at the foot of each form.
 *
 * ── Why a disabled button is never the only signal ──
 *
 * This button spends real time disabled: before the form is valid, and while a
 * registration is in flight. A greyed-out button with no explanation is the
 * single most common way a form dead-ends, so the screens that use this always
 * put the reason in text beneath it. That is also what makes the disabled
 * colour pair -- 2.19:1, below AA -- legitimate rather than merely exempt.
 *
 * ── Why `loading` is separate from `disabled` ──
 *
 * They mean different things to a screen reader. Disabled is "you cannot do
 * this yet"; busy is "it is happening, wait". Announcing the second as the
 * first would tell someone their tap failed when it succeeded.
 */
export default function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  loadingLabel,
  accessibilityHint,
  icon = null,
}) {
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      style={({ pressed }) => [
        styles.button,
        inert && styles.buttonInert,
        pressed && !inert && styles.buttonPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={loading ? (loadingLabel || `${label}, in progress`) : label}
      accessibilityState={{ disabled: inert, busy: loading }}
      accessibilityHint={accessibilityHint}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.disabledInk} />
        ) : icon}
        <Text style={[styles.label, inert && styles.labelInert]}>
          {loading ? (loadingLabel || label) : label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: radius.md,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  buttonPressed: { backgroundColor: colors.tealPressed },
  buttonInert: { backgroundColor: colors.disabledBg },
  content: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { ...type.button, color: colors.onTeal, textAlign: 'center' },
  labelInert: { color: colors.disabledInk },
});
