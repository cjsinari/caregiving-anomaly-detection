import { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, oneui, shadow, space, type, TOUCH_TARGET } from '../../theme/tokens';

/*
 * The rounded search bar from the assignments mockup.
 *
 * ── The clear button is not optional ──
 *
 * It is the difference between a search box and a trap. Someone who types
 * three letters, sees nothing, and has to find the backspace key eight times
 * on a phone they are holding one-handed will conclude the list is empty, not
 * that the filter is still on. The × is a 48dp target, it is announced, and
 * it returns focus to the field so the next search can be typed straight away.
 *
 * ── Why no debounce ──
 *
 * The filter runs over a list already in memory -- this is a caregiver's own
 * caseload, which is a handful of people, not a server-side search. Debouncing
 * a synchronous filter only adds a delay between the keystroke and the result.
 * If this ever becomes a request to the service, the debounce belongs here and
 * nowhere else.
 */
export default function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  accessibilityLabel = 'Search',
  resultCount = null,
}) {
  const input = useRef(null);

  const clear = () => {
    onChangeText('');
    input.current?.focus();
  };

  return (
    <View style={styles.wrap}>
      <Ionicons name="search" size={18} color={colors.label} style={styles.icon} />
      <TextInput
        ref={input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
        accessibilityLabel={accessibilityLabel}
        /*
         * The count is spoken, not drawn. A filtered list that shrinks is
         * obvious to someone looking at it and completely silent to someone
         * who is not, and "3 of 12 shown" is the fact they are missing.
         */
        accessibilityHint={
          resultCount == null ? undefined : `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`
        }
      />
      {value ? (
        <Pressable
          onPress={clear}
          style={styles.clear}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <View style={styles.clearDot}>
            <Ionicons name="close" size={13} color={colors.surface} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET + 4,
    borderRadius: oneui.radius.pill,
    backgroundColor: colors.surface,
    paddingLeft: space.lg,
    paddingRight: space.xs,
    ...shadow.card,
  },
  icon: { marginRight: space.sm },
  input: {
    flex: 1,
    ...type.body,
    color: colors.ink,
    paddingVertical: space.md,
    // Android's TextInput carries its own vertical padding on top of ours.
    paddingHorizontal: 0,
  },
  clear: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.placeholder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
