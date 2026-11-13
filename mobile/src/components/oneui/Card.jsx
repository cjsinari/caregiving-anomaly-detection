import { StyleSheet, Text, View } from 'react-native';
import Touchable from './Touchable';
import { colors, oneui, shadow, space, type } from '../../theme/tokens';

/*
 * The One UI card, and the grouped list that is really the same thing.
 *
 * One UI does not float every row on its own little card the way Material
 * does. Related rows live inside *one* rounded container, separated by
 * hairlines that stop short of the edges, and unrelated groups are separated
 * by empty space. That is what `Card` plus `Row` plus `Divider` is for, and it
 * is why there is no `elevation={3}` prop: depth is not how this design
 * language distinguishes things. Grouping is.
 *
 * The 26dp corner is the One UI signature and is not negotiable per usage --
 * cards at four different radii is the fastest way to make a screen look
 * assembled rather than designed. A control *inside* a card gets
 * `oneui.radius.inner` instead, because concentric corners need the inner one
 * to be smaller or the gap between them looks wrong at the diagonal.
 */

export function Card({ children, style, padded = true, onPress, ...a11y }) {
  const body = (
    <View style={[styles.card, padded && styles.padded, !onPress && style]}>
      {children}
    </View>
  );

  if (!onPress) return body;

  return (
    <Touchable
      onPress={onPress}
      style={[styles.card, padded && styles.padded, style]}
      accessibilityRole="button"
      {...a11y}
    >
      {children}
    </Touchable>
  );
}

/** A section title above a card group. The small all-caps line in the mockups. */
export function SectionHeading({ children, action, style }) {
  return (
    <View style={[styles.headingRow, style]}>
      <Text style={styles.heading} accessibilityRole="header">{children}</Text>
      {action || null}
    </View>
  );
}

/** The hairline between rows in a group. Inset, so it reads as a separator
 *  inside one surface rather than as the edge of two. */
export function Divider({ inset = space.lg }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/** A row inside a card: a label, an optional value, an optional chevron. */
export function Row({ children, style }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

/** A label/value pair, the shape most of the detail screen is made of. */
export function Field({ label, value, children }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children || (
        <Text style={styles.fieldValue} selectable>
          {value == null || value === '' ? '—' : String(value)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: oneui.radius.card,
    overflow: 'hidden',
    ...shadow.card,
  },
  padded: { padding: space.lg + 2 },

  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
    paddingHorizontal: space.xs,
    gap: space.md,
  },
  heading: { ...type.title, fontSize: 17, lineHeight: 24, color: colors.ink, flexShrink: 1 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.fieldBorder },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },

  field: { gap: 2 },
  fieldLabel: { ...type.label, color: colors.label, textTransform: 'uppercase' },
  fieldValue: { ...type.body, color: colors.ink },
});

export default Card;
