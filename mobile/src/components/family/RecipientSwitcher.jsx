import { ScrollView, StyleSheet, Text } from 'react-native';
import Touchable from '../oneui/Touchable';
import { useFamily } from '../../family/FamilyContext';
import { colors, oneui, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * Which loved one the portal is showing, when there is more than one.
 *
 * Draws nothing for a single loved one, which is most accounts: a one-option
 * switcher is a control that does nothing, sitting above the thing people
 * opened the app to read.
 *
 * Announced as a radio group, since exactly one is shown at a time and
 * picking one replaces the other on every screen -- which is also why the
 * choice lives in FamilyContext and not here.
 */
export default function RecipientSwitcher({ style }) {
  const { recipients, selected, select, displayName } = useFamily();
  if (recipients.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, style]}
      accessibilityRole="radiogroup"
      accessibilityLabel="Whose care to show"
    >
      {recipients.map((r) => {
        const active = r.id === selected?.id;
        return (
          <Touchable
            key={r.id}
            onPress={() => select(r.id)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${displayName(r)}${r.relationship ? `, ${r.relationship}` : ''}`}
          >
            <Text style={[styles.text, active && styles.textActive]} numberOfLines={1}>
              {displayName(r)}
            </Text>
          </Touchable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingBottom: space.lg },
  chip: {
    minHeight: TOUCH_TARGET - 8,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: oneui.radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.fieldBorder,
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  text: { ...type.captionMedium, color: colors.inkMuted },
  textActive: { fontFamily: type.button.fontFamily, color: colors.onNavy },
});
