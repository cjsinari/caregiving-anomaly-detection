import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Touchable from './Touchable';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * One line of the visit checklist, and the visible half of the optimistic
 * update that useOptimisticTasks drives underneath it.
 *
 * ── The tick is immediate and the spinner is somewhere else ──
 *
 * Acceptance criterion 2 of #44 is that completing a task updates the UI
 * immediately. So the box fills on the tap, before anything has been sent.
 * What is still in flight is shown by a small spinner *beside* the row, not by
 * the box itself: a box that shows a spinner instead of a tick has not updated
 * immediately, it has started loading, which is the behaviour the criterion
 * exists to rule out.
 *
 * ── A failed row stays tappable ──
 *
 * When the write fails, the box goes back to where it was and the row explains
 * itself in red. It does *not* disable itself. The overwhelmingly likely cause
 * is a second of bad signal in a stairwell, and the right answer is to tap it
 * again -- so the row says so, and the next tap retries.
 *
 * ── Why the row is not disabled while in flight either ──
 *
 * Because taps queue honestly: useOptimisticTasks numbers each attempt and
 * ignores replies to superseded ones, so a double-tap settles on whatever the
 * person last chose. Locking the row for 400ms of network instead would eat
 * the second tap of anyone working quickly down a five-item list.
 */
export default function TaskRow({
  label,
  done,
  pending = false,
  error = null,
  onToggle,
  disabled = false,
}) {
  return (
    <Touchable
      onPress={onToggle}
      disabled={disabled}
      scale={false}
      style={styles.row}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: done, disabled, busy: pending }}
      accessibilityHint={
        error ? `${error} Double tap to try again.` : done ? 'Double tap to mark as not done' : 'Double tap to mark as done'
      }
    >
      <View style={[styles.box, done && styles.boxDone, Boolean(error) && styles.boxError]}>
        {done ? <Ionicons name="checkmark" size={15} color={colors.onTeal} /> : null}
      </View>

      <View style={styles.body}>
        <Text style={[styles.label, done && styles.labelDone]}>{label}</Text>
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
        ) : null}
      </View>

      {/* Fixed-width slot, so the row does not shuffle sideways when the
          spinner appears and disappears. */}
      <View style={styles.trailing}>
        {pending ? <ActivityIndicator size="small" color={colors.label} /> : null}
        {!pending && error ? (
          <Ionicons name="refresh" size={16} color={colors.danger} />
        ) : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH_TARGET,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
  },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.label,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxDone: { backgroundColor: colors.teal, borderColor: colors.teal },
  boxError: { borderColor: colors.danger },

  body: { flex: 1, gap: 1 },
  label: { ...type.body, color: colors.ink },
  // Struck through as well as dimmed: on a list of five, "done" has to be
  // readable at a glance and dimming alone is close to invisible in daylight.
  labelDone: { color: colors.inkMuted, textDecorationLine: 'line-through' },
  error: { ...type.caption, fontSize: 12, color: colors.danger },

  trailing: { width: 24, alignItems: 'center', justifyContent: 'center' },
});

export const TASK_ROW_RADIUS = oneui.radius.inner;
