import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, type } from '../theme/tokens';

/*
 * The message under a field that failed validation.
 *
 * Carries an icon as well as red text. Colour alone cannot be what tells
 * someone their input was rejected -- roughly one in twelve men has some form
 * of colour vision deficiency, and this app's users skew older, where it is
 * more common still. The icon and the words do the work; the red is emphasis.
 *
 * `accessibilityLiveRegion` is what makes a screen reader announce the message
 * when it appears. Without it the error is drawn and never spoken, and a blind
 * user gets a submit button that silently does nothing.
 */
export default function FieldError({ message }) {
  if (!message) return null;
  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={14} color={colors.danger} style={styles.icon} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: space.xs + 2,
    gap: space.xs + 2,
  },
  icon: {
    // Nudged down so the icon sits on the text's first line rather than above it.
    marginTop: 2,
  },
  text: {
    ...type.caption,
    color: colors.danger,
    flex: 1,
  },
});
