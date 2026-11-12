import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadow, space, type, TOUCH_TARGET } from '../theme/tokens';

/*
 * The Caregiver / Family Member segmented control.
 *
 * ── This is the role selection screen ──
 *
 * Issue #41 asks for a separate screen that picks a role before the form. The
 * approved mockups put the choice at the top of the form instead, and that is
 * what is built here: it is one screen rather than two, the choice stays
 * visible and reversible while the form is filled, and nobody has to go back
 * to change it after reading a field that tells them they picked wrong.
 * Anyone switching mid-form keeps what still applies -- see RegisterScreen.
 *
 * ── Accessibility ──
 *
 * Announced as a radio group rather than as two buttons, because the two
 * options are mutually exclusive and a screen reader should say "1 of 2" and
 * "selected". Two plain buttons would give no hint that picking one unpicks
 * the other.
 */
export default function RoleToggle({ value, onChange, options, disabled = false }) {
  return (
    <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel="Account type">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => !disabled && !active && onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              active && styles.segmentActive,
              pressed && !active && !disabled && styles.segmentPressed,
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={option.label}
            accessibilityHint={active ? undefined : option.hint}
          >
            <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md + 2,
    padding: space.xs + 2,
    ...shadow.card,
  },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  // The selected segment is navy-filled in the mockups: 13.26:1 against its
  // white label, and distinguished by fill rather than by colour alone.
  segmentActive: { backgroundColor: colors.navy },
  segmentPressed: { backgroundColor: colors.field },
  text: { ...type.bodyMedium, color: colors.link },
  textActive: { fontFamily: type.button.fontFamily, color: colors.onNavy },
});
