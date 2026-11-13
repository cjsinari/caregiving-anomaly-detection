import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FieldError from './FieldError';
import { colors, radius, space, type, TOUCH_TARGET } from '../theme/tokens';

/*
 * The consent checkbox.
 *
 * ── Why this exists when the mockups have no such control ──
 *
 * The service refuses a registration without `consent: true`, and it is right
 * to: the Kenya Data Protection Act 2019 requires consent to be freely given,
 * specific and informed before personal data is processed, and this form
 * collects a phone number, an email address and -- for caregivers -- a
 * national identifier. A tick box the person actually ticks is the lightest
 * honest way to obtain that. Inferring consent from the act of submitting the
 * form would not be consent under the Act, and would also be a lie to the
 * service about what happened.
 *
 * It is unticked by default, which is the whole point. A pre-ticked box is not
 * consent either.
 *
 * ── Accessibility ──
 *
 * The whole row is the target, not just the 22px square -- the square alone
 * would be well under the 48dp floor. `accessibilityRole="checkbox"` plus the
 * checked state is what lets a screen reader announce it as a checkbox and
 * toggle it, rather than reading it as an anonymous blob of text.
 */
export default function Checkbox({ checked, onChange, onBlur, error, children, accessibilityLabel }) {
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => { onChange(!checked); onBlur?.(); }}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, invalid: Boolean(error) }}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={error}
      >
        <View style={[styles.box, checked && styles.boxChecked, Boolean(error) && styles.boxError]}>
          {checked ? <Ionicons name="checkmark" size={15} color={colors.onTeal} /> : null}
        </View>
        <Text style={styles.text}>{children}</Text>
      </Pressable>
      <FieldError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    // Padding rather than height, so a two-line label grows the row instead of
    // being clipped by it, while a one-line label still clears 48dp.
    paddingVertical: space.md,
    minHeight: TOUCH_TARGET,
    borderRadius: radius.sm,
  },
  rowPressed: { backgroundColor: colors.field },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.label,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    // Aligns the box with the first line of the label rather than the middle
    // of a label that wraps to three lines.
    marginTop: 1,
  },
  boxChecked: { backgroundColor: colors.teal, borderColor: colors.teal },
  boxError: { borderColor: colors.danger },
  text: { ...type.caption, color: colors.inkMuted, flex: 1 },
});
