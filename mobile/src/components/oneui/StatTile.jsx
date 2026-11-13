import { StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';
import { colors, oneui, shadow, space, type } from '../../theme/tokens';

/*
 * The three counters across the top of the dashboard: assigned, today,
 * completed.
 *
 * ── Why the number and the word are one accessible element ──
 *
 * Left alone, a screen reader reads this as "3" and then "Assigned Elders",
 * which arrives as two unrelated announcements and, swiped past at speed, as a
 * bare number with no idea what it counts. `accessible` on the wrapper and one
 * label -- "3 assigned elders" -- is the whole fix.
 *
 * ── Why the number is not the only thing that differs when it is zero ──
 *
 * "0 visits today" and "2 visits today" look identical apart from the digit,
 * and a zero at this size reads as a loading state or a bug. A tile at zero
 * dims its own number so it is legible as a deliberate nought rather than as
 * something that failed to arrive.
 */
export default function StatTile({ value, label, onPress, accessibilityLabel }) {
  const zero = value === 0 || value === '0';

  const body = (
    <>
      <Text style={[styles.value, zero && styles.valueZero]}>{value}</Text>
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
    </>
  );

  const a11y = {
    accessible: true,
    accessibilityLabel: accessibilityLabel || `${value} ${label}`,
  };

  if (onPress) {
    return (
      <Touchable
        onPress={onPress}
        style={styles.tile}
        accessibilityRole="button"
        {...a11y}
      >
        {body}
      </Touchable>
    );
  }

  return <View style={styles.tile} {...a11y}>{body}</View>;
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: oneui.radius.card - 4,
    paddingVertical: space.lg,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 86,
    ...shadow.card,
  },
  value: {
    fontFamily: type.hero.fontFamily,
    fontSize: 26,
    lineHeight: 34,
    color: colors.ink,
  },
  valueZero: { color: colors.placeholder },
  label: {
    ...type.caption,
    fontSize: 11,
    lineHeight: 15,
    color: colors.inkMuted,
    textAlign: 'center',
  },
});
