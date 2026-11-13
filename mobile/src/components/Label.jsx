import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme/tokens';

/*
 * The uppercase field label from the mockups, plus the two markers a form
 * needs and the mockups do not show.
 *
 * Every input in this app has one of these. A placeholder is not a label: it
 * disappears the moment someone types, it is invisible to a screen reader as a
 * name, and its contrast is below AA on purpose (see tokens.js). The visible
 * label is what makes that exemption legitimate.
 *
 * `optional` is marked rather than `required`, because all but two fields on
 * these forms are required -- marking the majority is noise, and the quieter
 * screen is the one where the exception stands out.
 */
export default function Label({ children, optional = false, nativeID }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label} nativeID={nativeID}>{children}</Text>
      {optional ? <Text style={styles.optional}>Optional</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  label: {
    ...type.label,
    color: colors.label,
    textTransform: 'uppercase',
  },
  optional: {
    ...type.caption,
    fontSize: 11,
    color: colors.inkMuted,
  },
});
